+++
title = "Grokking Apache Iceberg"
date = 2026-09-01
+++


## Intro
 - hard to get into. Multiple attempts while still able to use never felt that comfort like basic hive style.
 - When searching for references it often feels more like reading an advertisement with features like: ACID for open file formats, schema evolution and time travel. But it did not click until I started doing practical experiments and sit down and read the specs [REF] thrice.
 - Blog will walk you through the basics using examples and explain how many features work and why they are actually such an improvement.

## Key take message
In its essence Apache Iceberg is a specification of a table format.
This means that it specifies how the logical concept of a table, i.e. a 2-dimensional data structure with rows and columns, can be physically stored.
This specification contains all necessary information to implement a writer in any programming language that can take columnar data and store it in this table format.
But in contrast to encoding data in a specific file formats, the output is not just a single file, but multiple hierarchical organized metadata and data files.
Analog, one can implement a reader that understands these files and can read them like a logical table object.

This idea of a table format fits naturally in the process of unbundling database management systems (DBMS), which has been going on for the last ~20 years. 
In the end a DBMS is just a very complex system, with many interconnected components, that all work together in harmony to make storing data as tables, that can be manipulated with SQL, possible.
In the past, components of DBMS have been "cut" from this monolithic system and developed in isolation.
Examples of this are query engines like Apache Spark, that combine the query planning and execution part of a DBMS, or open file formats like parquet, that cut off the bottom storage layer, i.e. how data is encoded and compressed. 

This process of unbundling components comes with advantages, like freedom from proprietary systems and flexibility of choosing the best compatible systems for the problem at hand.
But the obvious disadvantage is, that in this process of unbundling one has to introduce boundaries between the isolated components.
These boundaries are necessary, and there has been lot's of work to increase compatibility, e.g. via [Apache Arrow](https://thingsworthsharing.dev/arrow/), but they still make the development of sophisticated features or optimizations that require an overarching view difficult.
Two examples for such component spanning features are access methods, i.e. how to most efficiently access the files that are necessary to serve a query, and concurrency control, i.e. how to ensure a consistent view of the data with multiple writers and readers.

Apache Iceberg makes such features possible without the need for a monolithic DBMS structure.
It improves on the table abstraction introduced by the Apache Hive Meta Store (HMS), which boils down to managing schema, location of data files and partitioning columns.
This abstraction was necessary to enable querying data stored in open file formats, like parquet, with SQL, but as we will later see, turned out to be too simple and rigid.
Apache Iceberg does by actually reducing the responsibilities of data catalogs, like the HMS is.
Instead it adds another layer of organization to allow for more sophisticated access of files, consistent concurrent writes and reads and feature like time travel, i.e. reading an older state of a table.

This organization layer is completely file based and only requires in-places writes, seek-able reads and deletes.
This way Apache Iceberg can be used on files systems or object-stores, like s3, for easy durability.
In spirit of the unbundling, Apache Iceberg does not depend on a single type of open file format to store the actual data, but in theory allows for any format to be used.
And finally this organization layer can be used with various data catalogs.

In the following I will explore this organization layer from the ground up, explaining why it was built this way and showcase the different usage patterns of Apache Iceberg.
 

## The old Hive way
Before we can appreciate what Apache Iceberg brings to the table (pun!), we must first understand how the table abstraction was initially handled by the HMS.

The HMS is a component of the distributed data warehouse Apache Hive, that enabled SQL queries on top of Apache Hadoop. 
It is responsible for registering and providing tables by storing metadata about them. 
This metadata includes (among other things):
 - Schema: Names and data types of the columns,
 - Location of the data i.e. URLs. Underlying is a distributed file system or object storage.
 - Partitions: How the data is split on specific columns without overlaps, e.g. by year.

In short, the HMS is a data catalog and the metadata it stores is necessary to run a query engine on top of a data source.
When a query engine receives a SQL query, it accesses the HMS to understand the underlying data, e.g. to check if referenced tables even exits, if the selected columns are present, if the expected data types align and if it can use optimizations like partition pruning.
Finally it the HMS is needed to actual know where the required data of a table can be found by using the stored location metadata.

### Hive demonstration
Now for a quick demonstration how this looks in practice.
For this we run a HMS instance in a docker container, which under the hood is an [[Apache Thrift]]-based server backed by some relational DBMS, in our case a PostgreSQL. 
To actually interact with the HMS we will be using the query engine PySpark and for storing our data we will use [minIO](https://github.com/minio/minio) as object storage, also running in docker. 
The code to run this youself can be found here [REF] and the setup looks like this:
{{ image(src="/images/iceberg/hms-setup.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 650px") }}


When all of this is running, we create a table for a small toy dataset of the Mavel X-Men (which we will use through the whole blog), using the following schema:
```python
spark.sql("""
CREATE TABLE IF NOT EXISTS xmen (
    id INT,             -- Identifier of the X-Man, e.g. 1
    name STRING,        -- Legal name of the X-Man, e.g. Scott Summers
    alias STRING,       -- The name the X-Man is usally referred to, e.g. Cyclops
    powers STRING,      -- The powers of the X-Man as a comma seperated string, e.g. Optic blasts, team leadership
    birth_year INT      -- The year the X-Man was born, e.g. 1970
)
PARTITIONED BY (active BOOLEAN) -- Is the X-Man still participating in adventures, e.g. true.
STORED AS PARQUET -- We use parquet as our open file format
LOCATION 's3a://warehouse/xmen' -- Path in our minio object storage
""")
```

Afterwards I insert some data first of `active=true` X-Men:

```python
spark.sql("""
INSERT INTO xmen PARTITION (active=true) VALUES
    (1, 'Scott Summers', 'Cyclops', 'Optic blasts, team leadership', 1970),
    (2, 'Jean Grey', 'Phoenix', 'Telepathy, telekinesis, Phoenix Force', 1972),
    DISTRIBUTE BY 1  -- Force single file
""""
```

and then `active=false` ones:
```python
spark.sql("""
INSERT INTO xmen PARTITION (active=false) VALUES
    (3, 'Hank McCoy', 'Beast', 'Super strength, agility, genius intellect', 1968),
    (4, 'Pietro Maximoff', 'Quicksilver', 'Super speed', 1980),
    DISTRIBUTE BY 1  -- Force single file
""")
```

From a data lake perspective the result is simple. 
If we view the minio UI we see two parquet files, nested in the prefix `/warehouse/xmen/active=true` and `/warehouse/xmen/active=false` respectively, using the partitioning column `active` as a hierarchy level.
{{ image(src="/images/iceberg/minio.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 950px") }}


But what happened in the HMS?
To understand this we can access the underlying PostgreSQL, e.g. using [DBeaver](https://dbeaver.io/).
Here we are overhelmed with many tables, you can see a full overview of the HMS database entity relationship diagram [here](https://analyticsanvil.wordpress.com/wp-content/uploads/2016/08/hive_metastore_database_diagram.png). 
For a basic understanding the following tables are most important (note that I omitt a lot of columns for readability):
 - `TBLS`: This holds all the tables that have been registered with the HMS. In our case as we jus created a single table it holds the single record:

|TBL_ID|SD_ID|TBL_NAME|
|------|-----|--------|
|1|1|xmen|

 - `COLUMNS_V2`: This table holds all columns that are registered in the HMS, giving their name and data type. We only see the columns for our single table, while the partitioned column `active` is even missing.

 |CD_ID|COLUMN_NAME|TYPE_NAME|INTEGER_IDX|
|-----|-----------|---------|-----------|
|1|id|int|0|
|1|name|string|1|
|1|alias|string|2|
|1|powers|string|3|
|1|birth_year|int|4|

 - `PARTITION_KEYS`: This now holds the previously missing partition column:

|TBL_ID|PKEY_NAME|PKEY_TYPE|INTEGER_IDX|
|------|---------|---------|-----------|
|1|active|boolean|0|


 - `PARTITIONS`: This holds all partitions that have been created. In our case we have a single boolean partition column, hence two records are present that are linked to our table via `TBL_ID`:


|PART_ID|PART_NAME|SD_ID|TBL_ID|
|-------|---------|-----|------|
|1|active=true|2|1|
|2|active=false|3|1|

 - `SDS`: Standing for "storage descriptors" this table holds the locations in the data lake where the associated data for our table lives. We have three records, the first being the highest hierarchy level giving the path prefix to all data files of the tables, and two records for each partition one. 

|SD_ID|LOCATION|CD_ID|
|-----|--------|-----|
|1|s3a://warehouse/xmen|1|
|2|s3a://warehouse/xmen/active=true|1|
|3|s3a://warehouse/xmen/active=false|1|

As a very simplified entity relationship diagram, this looks like this:
{{ image(src="/images/iceberg/hms-er-diagram.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 450px") }}

With this in mind we can formulate the HMS table abstraction as:
A table is an entity that has an associated base prefix location under which all of its data is stored.
Additionally it can have partitions, each with an associated prefix location lower in the hierachy than the base prefix location.
Finally, the schema of a table is connected to its storage locations and not directly to the table.

Let's see what this table abstraction has for implications in practice.
Imagine we run the following query 
```sql
select name, powers
from xmen
where active = false 
```
with our query engine.
The query engine would then need to get information from the HMS on how to actually excute this query, i.e. create a query plan.
This process could look something like this, first `TBLS` must be checked if the table `xmen` does even exists.
Then `PARTITION_KEYS` is used to check if the column `active` used in the predicate filter is a partitioning column.
In our case it is, which allows the query engine to get only the prefix location for the requested partition value from the table `SDS` via the `PARTITIONS` table.
Finally it can validate if all the columns requested in the projection, i.e. `name` and `powers`, are present by querying `COLUMNS_V2`.

After this is done the query engine knows if the query can even be answered and if so, where the data resides that it must scan.
But to actually plan the tasks that need to be executed the query engine must know exactly what files need to be scanned.
This means that for every location it must scan it must list all files that sit behind it, e.g. for s3 with the API call [`ListObjectsV2`](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html).
The time it takes to find all files scales with the number of locations to scan and files behind each, as not all files can be listed in a single API call. 
With a latency around 200 ms per API call for cloud storage, this means that depending on the size of a table, how many partitions it has and how its files are compacted, a query engine could spend multiple minutes just listing files to plan how to execute a query, without actually touching the data once.
This shortcoming was the main reason why [Netflix even invented Apache Iceberg](https://conferences.oreilly.com/strata/strata-ny-2018/cdn.oreillystatic.com/en/assets/1/event/278/Introducing%20Iceberg_%20Tables%20designed%20for%20object%20stores%20Presentation.pdf) back in 2017, and we will later soon see how they solved it.  


### Other shortcomings
Besides the listing of files problem there are many other things that one may want to do with a table abstraction that are either cumbersome or not possible with the Hive style.
For example:
 - What happens if we want to use spaces in the partitioning values? As the partitions are integrated in the file path or URL, issues can arise with spaces, slashes or other special characters.
 - How could we delete or update a single row in a table? In the Hive style the only way is to overwrite either a single partition, if partitioned, where the row is located, or the whole table. For big tables this can be a huge operation for a tiny change.
 - What happens when a reader the reads a table, while a parallel write adds files? Per default this could result in the reader seeing data that was written after they started their query ([[Dirty reads]]) or even an inconsistent state. (Note, that this issue was addressed by introducing [transactions](https://hive.apache.org/docs/latest/user/hive-transactions/#table-properties).)
 - What happens if we want to evolve the schema? For adding new columns old data will just produce `nulls`. But changing order or removing won't validate. TODO: Test this.
        Docs for this can be found [here](https://cwiki.apache.org/confluence/spaces/Hive/pages/27362034/LanguageManual+DDL#LanguageManualDDL-AlterTable/PartitionUpdatecolumns).
        Added a test of what is possible in the script.
 - What happens if we want to change the way the data is partitioned? In the Hive style we would need to rewrite all the data of a table.

 - What could we do to look at an older state of the data? In the Hive style there exists only one version of the table, the current one. If we want to have a history, we would need to either add this in the data model, e.g. by using [[Slowly changing dimensions]] or store a copy of the full table for a point in time of the granularity we want, e.g. partitioning by year, month and day. This either introduces a lot of complexity or wastes storage.

All the above shortcomings can be traced back to the simplicity of design of the HMS table abstraction.
While the approach of a table being a pointer to a directory or prefix and modeling partitions directly in the path hierarchy is intuitive and easy to reason about, it reduces flexibility and makes some operations expensive.
With this tradeoff established let's deep dive in to the design of Apache Iceberg to understand how it introduced a complex organization layer to overcome these shortcomings.

## Core ideas
To overcome these shortcomings Apache Iceberg diverged from the Hive style by adapting the following two core ideas:
 1. Pull most of the metadata responsibility out of the data catalog. For Apache Iceberg tables the data catalog only stores the table name and a URL to a file that holds the actual metadata, which can be atomically switched. This drastically reduces the load on the data catalog and allows for easy compatibility with various catalogs.
 2. Introduce a new metadata layer that is entirely based on immutable files, which sits on top of the files that actually store the data, i.e. data files. Here hierarchical ordered files actually define the table and state how the data files should be interpreted. This decouples the physical storage of data from its logical interpretation, which yields a lot of flexibility.

With this change the logical representation of a table is spread across three layers:
{{ image(src="/images/iceberg/layers.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 450px") }}
 
Let's look at these the responsibilities and components of these layers from the bottom up. But note, that this will just be a simplified view and details will be covered in later sections.

TODO: Mention something on filesystem here?! I have an image for object storage vs filesystem.


### The data layer
In this layer the actual data that make up a table is stored in separate files. 
Here no restriction on the actual format of these data files is given by Apache Iceberg and in theory any format could be used or even various once used for a single table. 
But in practice the common implementations support [[Parquet]], [[Apache ORC]], [[Avro]] or [[Puffin file format]].

It is important to note here, that a table is not given by simply combining all data files at this layer. 
They simply serve as building blocks, where the metadata layer is the manual that shows how to combine them.
This means that deprecated files that are no longer part of a table can still be present here but will simply be ignored on a read.
Or, as we will later see in detail, data files can in fact represent rows that were deleted from a table and then be used to remove rows from other data files on a read.

When a writer modifies an Apache Iceberg table, e.g. by appending rows to it, it first writes the data files. 
Afterwards it moves up to the above metadata layer to write the metadata file to give the data files meaning.
If something goes wrong while the metadata is written, some concurreny confict, the data files do not need to be rewritten and the process can just be restarted.
This is great, because writing data files should take up the majority of time and would be wasteful to repeat.

{{ image(src="/images/iceberg/data-layer.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 650px") }}

### The metadata layer
The metadata layer is the core of Apache Iceberg and fully described in the specification. 
It consists of the following components:
 - **Metadata files**
 - **Snapshots**
 - **Manifest lists**
 - **Manifest files**
which are hierarchicaly ordered, with the final goal to map many data files to a single logical table abstraction.

{{ image(src="/images/iceberg/metadata-layer.png", alt="", style="border-radius: 0px; float: right; padding: 10px; margin: 10px 0 10px 20px;width: 450px") }}

A **metadata file** is a JSON file that represents a version of a table. 
It holds all snapshots that are valid for a table version.

A **snapshot** is a representation of a table at a point in time and points to a manifest list. 
It is stored in a metadata file.

A **manifest list** is an Avro file that groups manifest files. 

A **manifest file** is an Avro file that simply groups and describes data files. 
It therefore acts as the connection of the metadata layer with the data layer. 


At this point it becomes clear where the name Iceberg stems from. 
Like an Iceberg where 90% of it is hiding below the surface, an Iceberg table has all of these files hidden below it.

To comeback to the appeneding rows example, after a writer has written data files to modify a table it must then write one or more manifest files that group and reference them. 
Then it must create a new manifest list that contains the new manifest files. 
Finally it must create a new metadata file based on the previous one that contains a new snapshot that points to the new manifest list file.

Complementarily a reader must be able to obtain a list of all data files that make up a table by first reading the metadata file and selecting a snapshot of choice.
Then reading the corresponding manifest list file and all the manifest files that are grouped in it, to then finally extract all data files locations from it.
Note here, that instead of running multiple `ListObjectsV2` API calls to obtain the data files locations, like in the Hive style, now they can just be extracted from manifest files.
(But this of course assumes that every manifest file lists many data files and we do not end up with a 1:1 mapping, which will be discussed later)
And this is also why Avro, a row-by-row based file format, is [used for the manifest files](https://www.linkedin.com/posts/thevijayshekhawat_apacheiceberg-avro-apacheiceberg-activity-7251600923683106816-Ac7D?utm_source=share&utm_medium=member_android&rcm=ACoAADJPVrMB9QqVtGNhbb3m2BEJ70Wp8czoIS4) as the data files metadata is extracted in full sequentially from them.


### The data catalog layer
The data catalog layer has two simple responsibilities. 
First it must store a location, i.e. URL, for every table that points to it's current metadata file.
This location is used by writers or readers as an entry point when writing to or accessing a specific table. 
Second it must allow to swap this metadata file location with one that points to a new version. 
This is used by writers when a table is modified. 

For the swapping optimistic concurrency control is used to ensure consistency when multi writers modify a table in parallel. 
This means that conflicts, i.e. writers at the same time, are considered to be rare.
Hence a write will just write all data and metadata layer files and only at the final step check if no other write has updated the metadata file location in the meantime. 
For this it only swaps the old location with the new one, if the old location is still what it expects and used to build the new metadata file by using a compare and swap operation. 
If this fails it simply tries again by writing a new metadata files based on the current state.

Note here, that there data catalog layer can be implemented by [various compatible types](https://lakefs.io/blog/iceberg-catalog/), that may be harder or easier to deploy and maintain or come with extra features.

{{ image(src="/images/iceberg/data-catalog-layer.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 850px") }}

## Examples

TODO: write segway

 - We will use multiple implementations.
 - go through examples one by one 
 - Code is here if you want to follow along.


### Example: Create an Iceberg table and show file structure
The first thing we are going to do is create an Iceberg table and have a deeper look at the metadata layer.
For this we will be using PyIceberg and for our data catalog we use an sqlite database for simplicity.

```python
from pyiceberg.catalog import load_catalog

catalog = load_catalog(
    # Name of the catalog. One can store multiple catalogs in the same database.
    "marvel",
    **{
        # We will use the SQLCatalog type.
        "type": "sql",
        # Gives the location of the sqlite database.
        "uri": f"sqlite:////tmp/warehouse/pyiceberg_catalog.db",
        # Gives the path were the metadata and data of the tables will be stored.
        "warehouse": f"file:///tmp/warehouse",  
    },
)
```

This will create the sqlite database `pyiceberg_catalog.db` in the `/tmp/warehouse/` directory.
{{ image(src="/images/iceberg/example-catalog-01.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 650px") }}
Inside this directory we can access it using `sqlite3 ./pyiceberg_catalog.db`.
Use `.header on` and `.mode column` before querying for a nicer output.

```
$ sqlite3 pyiceberg_catalog.db
SQLite version 3.45.1 2024-01-30 16:01:20
Enter ".help" for usage hints.
sqlite> .headers on
sqlite> .mode column
```

We can convice ourselves that this holds Iceberg data catalog data by viewing the current tables:
```
sqlite> .tables
iceberg_namespace_properties  iceberg_tables
```

We can now create namespaces in this catalog.
Namespace are used to hierarchically group tables and are useful to avoid name conflicts. One can also give the properties, which can be useful to e.g. give more information like description or owner, but can also be used to give a specific location where data of this namespace shall be stored.
Let's create one namespace for the X-Men
```python
catalog.create_namespace_if_not_exists(
    "xmen",
    properties={
        "description": "Mutant superheroes with powers",
        "owner": "professor_x",
        "location": f"file:///tmp/warehouse/xmen",
    },
)
```

We can now see in the database/data catalog:
```
sqlite> select * from iceberg_namespace_properties;
catalog_name  namespace  property_key  property_value
------------  ---------  ------------  ------------------------------
marvel        xmen       description   Mutant superheroes with powers
marvel        xmen       owner         professor_x
marvel        xmen       location      file:///tmp/warehouse/xmen
```

Now let's create our first Iceberg table.
For this we first load a csv of X-Men characters as an arrow table,
```python
from pyarrow.csv import read_csv

df = read_csv("./X-Men.csv")
```

which looks like this:
| id | name | alias | powers | birth_year | active |
|----|------|-------|--------|------------|--------|
| 1 | Scott Summers | Cyclops | Optic blasts, team leadership | 1970 | TRUE |
| 2 | Jean Grey | Phoenix | Telepathy, telekinesis, Phoenix Force | 1972 | TRUE |
| 3 | Logan | Wolverine | Regeneration, adamantium claws | 1880 | TRUE |
    ...


Then we can create a table using:

```python
table = catalog.create_table(
    identifier="xmen.characters",
    schema=df.schema,
)
```

Afterwards our filesystem structure has changed to:
{{ image(src="/images/iceberg/example-catalog-02.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 850px") }}
and we have our very first metadata file, `00000-<uuid-a>.metadata.json`.
Note here that I shortened the filename for readability, and will do so for all other files. 
For metadata files the filename follows the pattern `<version_number>-<UUID>.metadta.json`, where `version_number` is 5-digit zero padded and increases with every commit, i.e. change of the table.


Meanwhile in our database/data catalog we now have a row in the `iceberg_tables` table:

```
sqlite> select * from iceberg_tables;
catalog_name  table_namespace  table_name  metadata_location           previous_metadata_location
------------  ---------------  ----------  --------------------------- --------------------------
marvel        xmen             characters  file:///tmp/warehouse/xmen/
                                           characters/metadata/
                                           00000-<uuid-a>.metadata.json
```

If we inspect the JSON file we see (shortened)
```json
{
  "location": "file:///tmp/warehouse/xmen/characters",
  "table-uuid": "037f79f9-1e57-4a8e-bb25-f173924c3e3c",
  "last-updated-ms": 1754402272360,
  "last-column-id": 6,
  "schemas": [
    {
      "type": "struct",
      "fields": [
        {
          "id": 1,
          "name": "id",
          "type": "long",
          "required": false
        },
        {
          "id": 2,
          "name": "name",
          "type": "string",
          "required": false
        },
        [...]
      ],
      "schema-id": 0,
      "identifier-field-ids": []
    }
  ],
  "current-schema-id": 0,
  "partition-specs": [
    {
      "spec-id": 0,
      "fields": []
    }
  ],
  "default-spec-id": 0,
  "last-partition-id": 999,
  "properties": {},
  "snapshots": [],
  "snapshot-log": [],
  "metadata-log": [],
  "sort-orders": [
    {
      "order-id": 0,
      "fields": []
    }
  ],
  "default-sort-order-id": 0,
  "refs": {},
  "statistics": [],
  "format-version": 2,
  "last-sequence-number": 0
}
```

Don't get lost in the details.
Some things immediately catch the eye, e.g. we have a `location` like in Hive style and a list of `schemas`, but the amount of metadata is at first overhelming.
But the important part is that this structure already promises that a lot of metadata will be stored on an Iceberg table, and we will gradually understand some of the fields down the line.

Next, we want to insert data into our table.
For this we just append our data frame:

```python
table.append(df)
```

This results in four new files in our filesystem, three in the metadata layer and one in the data-layer: 
{{ image(src="/images/iceberg/example-catalog-03-new.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 850px") }}

And inside our database/data catalog, we see that the metadata location has changed:

```
sqlite> select * from iceberg_tables;
catalog_name  table_namespace  table_name  metadata_location            previous_metadata_location
------------  ---------------  ----------  ---------------------------- ----------------------------
marvel        xmen             characters  file:///tmp/warehouse/xmen/  file:///tmp/warehouse/xmen/  
                                           characters/metadata/         characters/metadata/
                                           00001-<uuid-b>.metadata.json 00000-<uuid-a>.metadata.json
```

The current metadata location now points to the new metadata file `00001-<uuid-b>.metadata.json`, notice the increment in the version number, while the previous location points to the old one.
This shows that in the process of appending data to the table we have not just written new data and metadata files, but done an atomic commit in our data catalog to change this.
This atomic commit is responsible for making all newly written data "visible" for the table, because for any reader the table is just what the metadata file states.

Let's inspect this on a deeper level and first look at the most important part that changed when going from version `00000` to `00001`.
In version `00000` we had an empty list of snapshots:
```json
"snapshots": [],
```
while in `00001` we now have this:
```json
"snapshots": [
     {
       "snapshot-id": <id-1>,
       "sequence-number": 1,
       "timestamp-ms": 1754402715529,
       "manifest-list": "file:///tmp/warehouse/xmen/characters/metadata/snap-<id-1>-0-<uuid-1>.avro",
       "summary": {
         "operation": "append",
         "added-files-size": "2846",
         "added-data-files": "1",
         "added-records": "10",
         "total-data-files": "1",
         "total-delete-files": "0",
         "total-records": "10",
         "total-files-size": "2846",
         "total-position-deletes": "0",
         "total-equality-deletes": "0"
       },
       "schema-id": 0
     }
   ]
"current-snapshot-id": <id-1>,
```

Here we observe two things, first we now have a snapshot in our `snapshots` list, and like previously stated, a snapshot represents a table at a point in time.
We can see that a snapshot has a `snapshot-id`, to uniquely identify it, and that it contains information on the last operation that was used to create it, in our case we did an `append` for `10` X-Men.
But most importantly a snapshot points to a manifest list file, in our case `snap-<id-1>-0-<uuid-1>.avro`, which we will look into more detail soon.

Second, the metadata file now has a field called `current-snapshot-id`, which gives the id of the snapshot that is currently "active" for this table.
In our case it is simply the most recently created, and only, snapshot.
This field is used when a reader loads the metadata JSON to identify what snapshot is active and hence what manifest list file it must load next.

Speaking of the manifest list file, let's examine it next.
Regarding its filename it follows the pattern `snap-<snapshot_id>-<attempt>-<commit_uuid>.avro`, where `snapshot_id` is the id of the snapshot, `attempt` starts at `0` and is incremented for every conflict when attempting to change the location in the data catalog, and `commit_uuid` is the UUID associated with the commit.
To inspect it we can use [avro-tools](https://github.com/satoshihirose/how-to-use-avro-tools) and [jq](https://jqlang.org/), 
```bash
alias avro-tools='java -jar ~/tools/avro-tools-1.11.3.jar'
avro-tools tojson "snap-<id-1>-0-<uuid-1>.avro" | jq
```
which gives the following:
```json
{
  "manifest_path": "file:///tmp/warehouse/xmen/characters/metadata/<uuid-1>-m0.avro",
  "manifest_length": 4655,
  "partition_spec_id": 0,
  "content": 0,
  "sequence_number": 1,
  "min_sequence_number": 1,
  "added_snapshot_id": <id-1>,
  "added_files_count": 1,
  "existing_files_count": 0,
  "deleted_files_count": 0,
  "added_rows_count": 10,
  "existing_rows_count": 0,
  "deleted_rows_count": 0,
  "partitions": {
    "array": []
  },
  "key_metadata": null
}
```
Ignoring the metadata for the moment, the most important part is the field `manifest_path` pointing to a manifest file.
And if we inspect the manifest file using:

```bash
avro-tools tojson "<uuid-1>-m0.avro" | jq
```

we see:

```json
{
  "status": 1,
  "snapshot_id": {
    "long": 1110035385487351968
  },
  "sequence_number": null,
  "file_sequence_number": null,
  "data_file": {
    "content": 0,
    "file_path": "file:///tmp/warehouse/xmen/characters/data/00000-0-<uuid-1>.parquet",
    "file_format": "PARQUET",
    "partition": {},
    "record_count": 10,
    "file_size_in_bytes": 2846,
    "column_sizes": {
        [...]
    },
    "value_counts": {
        [...]
    },
    "null_value_counts": {
        [...]
    },
    "nan_value_counts": {
      "array": []
    },
    "lower_bounds": {
      "array": [
            [...]
        {
          "key": 3,
          "value": "Beast"
        },
            [...]
      ]
    },
    "upper_bounds": {
      "array": [
            [...]
        {
          "key": 3,
          "value": "Wolverine"
        },
            [...]
      ]
    },
    "key_metadata": null,
    "split_offsets": {
      "array": [
        4
      ]
    },
    "equality_ids": null,
    "sort_order_id": null
  }
}
```

Here I have ommitted many fields for readability, but the key insight is that the manifest file lists data files.
In our case it stores just one, i.e. `00000-0-<uuid-1>.parquet`, which follows the filename pattern `00000-<task_id>-<commit_uuid>.parquet`, where `task_id` is specific to the writer used to create it.
Additionally, it stores metadata information on the data inside those data files, e.g. `lower_bounds` and `upper_bounds` give the bound values for each column.
For example for the name field, which has the id `3`, we can see that the data file `00000-0-<uuid-1>.parquet` contains on the lower bound the X-Man "Beast" and on the uppper "Wolverine".
If would be looking for the X-Man "Angel", which is not included in this range, we instantly know that we could skip this data file.
This technique is called [[pruning]] and becomes very efficient in Apache Iceberg, because we can directly prune from the manifest file level, without having to query the indiviual underlying data files metadata.

To summarize our table is given by the following file hierachy:
{{ image(src="/images/iceberg/example-catalog-04.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 350px") }}
which a reader just traverses to collect all data files that make up the current state of a table.

For the following examples, if not stated otherwise, we will use this state as a base to showcase other features.

### Example: Append more X-Men
As a simple next example we just want to add three more X-Men stored in a  CSV.
We can simply do this using:
```python
df = read_csv("./x-men2.csv")
table = catalog.load_table(identifier="xmen.characters")
table.append(df)
```

Looking at the filesystem structure we see the same result as for the first append: three more metadata files and one data file.
{{ image(src="/images/iceberg/example-append-01.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 850px") }}

But in contrast, the now active manifest list file does not only point to one manifest file, but two:

{{ image(src="/images/iceberg/example-append-02.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 550px") }}

The idea stays the same: A reader loads the manifest file and traverses all child manifest files and associated data files to get the current state of the table.
Why it may seem wasteful that a simple append produces that many files, this wastefulness is exactly what gives Apache Iceberg its powers.
Because now we not only see the current state of the table, but have the information what operations where done in what order to get to this state, see for example what the snapshot list of the metadata file `00002-<uuid-c>.metadata.json` looks like:
```json
"snapshots": [
  {
    "snapshot-id": <id-1>,
    "sequence-number": 1,
    "timestamp-ms": 1754402715529,
    "manifest-list": "file:///tmp/warehouse/xmen/characters/metadata/snap-{id-1}-0-<uuid-1>.avro",
    "summary": {
      "operation": "append",
      "added-files-size": "2846",
      "added-data-files": "1",
      "added-records": "10",
        [...]
    },
    "schema-id": 0
  },
  {
    "snapshot-id": <id-2>,
    "parent-snapshot-id": <id-1>,
    "sequence-number": 2,
    "timestamp-ms": 1754405155465,
    "manifest-list": "file:///tmp/warehouse/xmen/characters/metadata/snap-{id-2}-0-<uuid-2>.avro",
    "summary": {
      "operation": "append",
      "added-files-size": "2571",
      "added-data-files": "1",
      "added-records": "3",
        [...]
    },
    "schema-id": 0
  }
],
```

### Example: Delete an X-Man
In this example we want to delete an X-Man from the table, because their existence was eliminated from all timelines. 
Without Apache Iceberg we would need to do the following:
 1. Find the file were the X-Man is stored.
 2. Load it into memory.
 3. Delete the record of the X-Man we want to delete.
 4. Overwrite the orignal file, now without the deleted record.

Depending on the table setup this could result in either loading a single file, loading many files that belong to a single partition or loading all files that belong to the table.
Hence, for big tables and a number of records to be deleted this can be a wasteful operation.
While the way our table is partitioned could limit the overwrite to only a few partitions, the deletion of a single row from a table with several giga byte large partitions still involves large unnecessary data movements.

Apache Iceberg solves this issue by not actually deleting records in the data files, but by adding the concept of a delete file. 
A delete file shares a lot of similarities with a data file, but instead of describing records that are "added" to a table, it describes records that are "removed". 
They therefore act like a filter to remove records from previously added data files.

Let's look at an example, where we will use PySpark, because [PyIceberg does not support writing delete files yet](https://iceberg.apache.org/status/#table-spec-v2_3).
We first create a `SparkSession` that is connected to our already sqlite data catalog
```python
from pyspark.sql import SparkSession

spark = (
    SparkSession.builder.appName("deleting-x-man")
    # Iceberg packages
    .config(
        "spark.jars.packages",
        "org.apache.iceberg:iceberg-spark-runtime-4.0_2.13:1.10.0,"
        "org.xerial:sqlite-jdbc:3.46.0.0",
    )
    # Configure catalog to use SQLite via JDBC
    .config(
        "spark.sql.extensions",
        "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions",
    )
    .config("spark.sql.catalog.marvel", "org.apache.iceberg.spark.SparkCatalog")
    .config("spark.sql.catalog.marvel.type", "jdbc")
    .config(
        "spark.sql.catalog.marvel.uri",
        "jdbc:sqlite:////tmp/warehouse/pyiceberg_catalog.db",
    )
    .config("spark.sql.catalog.marvel.warehouse", "file:///tmp/warehouse")
    .getOrCreate()
)
```

Then we delete the unlucky Cyclopse by id

```python 
spark.sql("DELETE FROM marvel.xmen.characters WHERE id = 1")
```

If we inspect filesystem structure we see the following:

{{ image(src="/images/iceberg/example-delete-01.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 850px") }}

No delete file written.
Instead, if we inspect the latest snapshot, we see that it points to the two new manifest files.
```json
{
  "manifest_path": "file:/tmp/warehouse/xmen/characters/metadata/<uuid-2>-m1.avro",
  "manifest_length": 7373,
  "partition_spec_id": 0,
  "content": 0,
  "sequence_number": 2,
  "min_sequence_number": 2,
  "added_snapshot_id": 48153905500596197,
  "added_files_count": 1,
  "existing_files_count": 0,
  "deleted_files_count": 0,
  "added_rows_count": 9,
  "existing_rows_count": 0,
  "deleted_rows_count": 0,
  "partitions": {
    "array": []
  },
  "key_metadata": null
}
{
  "manifest_path": "file:/tmp/warehouse/xmen/characters/metadata/<uuid-2>-m0.avro",
  "manifest_length": 7371,
  "partition_spec_id": 0,
  "content": 0,
  "sequence_number": 2,
  "min_sequence_number": 2,
  "added_snapshot_id": 48153905500596197,
  "added_files_count": 0,
  "existing_files_count": 0,
  "deleted_files_count": 1,
  "added_rows_count": 0,
  "existing_rows_count": 0,
  "deleted_rows_count": 10,
  "partitions": {
    "array": []
  },
  "key_metadata": null
}

```
If we look inside the corresponding manifest files, we find that the `<uuid-2>-m0.avro` manifest file points to the old `00000-0-<uuid-1>.parquet` data file with ten X-Men.
This one is marked as deleted in the manifest list `"deleted_files_count": 1,`, so it will not be considered for the current state of the table.
The `<uuid-2>-m1.avro` manifest file points to the new `00000-0-<uuid-2>.parquet` data file with only nine X-Men, which now make up the whole table.
{{ image(src="/images/iceberg/example-delete-02.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 550px") }}


We got this result, because per default the [`write.delete.mode` of our Iceberg table is set to `copy-on-write`](https://iceberg.apache.org/docs/latest/configuration/#write-properties).
In this mode the writer has to do the heavy lifting and whole data files are copied and rewritten, just like described above.
But Iceberg allows to change behavior.


Let's rewind time, and delete Cyclopse again, but this time with the `merge-on-read` mode. 
For this we first have to alter our table properties, using
```python
spark.sql("ALTER TABLE marvel.xmen.characters SET TBLPROPERTIES ('write.delete.mode' = 'merge-on-read')")
```
and then just delete Cyclopse again
```python
spark.sql("DELETE FROM marvel.xmen.characters WHERE id = 1")
```
Like always we check the filesystem structure to see what happened:
{{ image(src="/images/iceberg/example-delete-03.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 850px") }}

We now have a delete file!
Also, we have an additional metadata file, which captures the change of the `write.delete.mode`.
Inspecting the latest snapshot we see the following hierachy:
{{ image(src="/images/iceberg/example-delete-04.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 550px") }}

When the table is now read first the data files are loaded.
Then the delete files are loaded
 - This is an posittion delete file now
 - With multiple deletes and appends and stuff things are more complex and require a sequence number to apply data and delete fiels in correct order


 - Then do v3 move



 - Explain the equality deletes quickly with the rust script. Don't go too deep into detail.

Check this Reference for details: 
https://www.linkedin.com/pulse/delete-files-vs-deletion-vectors-apache-iceberg-how-v3-alex-merced-uo58e?utm_source=share&utm_medium=member_android&utm_campaign=share_via

And see here the PyIceberg is working on a V3 Implantation:
https://github.com/apache/iceberg-python/issues/1818

### Example: Upsert
Use an upsert to manipulate rows.
See what happens.

Writer here about the difference between:
 - merge-on-read
 - copy-on-write

### Example: Schema evolution

### Example: partitioning 
Show what happens when we add partitioning.


### Example: table scan
Show what files are loaded compare lower bound and higher bound.

With this I should have explained lot of the advantages.

### Example: Branching and References

### Example: Time travel


## Transcational
How is concurrency handled?
Maybe start two transactions synchronously and then see what happens if the other commits first.

- NEW: Maybe I can just move all of this to the data catalog (Hive) section on the demands for atomic swaps.

See for example how `append` method on `Table` is using transcations:
```python
def append(self, df: pa.Table, snapshot_properties: Dict[str, str] = EMPTY_DICT) -> None:
    """
    Shorthand API for appending a PyArrow table to the table.

    Args:
        df: The Arrow dataframe that will be appended to overwrite the table
        snapshot_properties: Custom properties to be added to the snapshot summary
    """
    with self.transaction() as tx:
        tx.append(df=df, snapshot_properties=snapshot_properties)
```

I probably also can't do this with SQLCatalog as sqlite does not support concurrency.




## New ideas
 - While the idea of the spec is nice it seems that not all other programming languages have kept up and the java implementation is the source of Truth, see https://github.com/apache/iceberg-rust/issues/1816.
 - In PyIcerberg it is very simple to just append data. Behind the scenes there it actually a transaction being opened, a arrow table written out to parquet, manifest files written. I should show this, maybe visually.
 - I can use rust and PyIceberg in this blog to show that the spec is language agnostic. This way I can also overcome the issue of some things missing in some implementations and how the difference between the write and read path.
 - write more on how all the stuff that iceberg puts in-between the catalog and the actual data files enables flexibility and real data warehouse capabilities. But it pushes the load to the reader and writers. But with COW vs MOR the read vs write path can be tuned.
 - thing about comparison to traditional data warehouses that have full control. Iceberg is more about openness and interoperability instead of full performance.
 - Iceberg is the natural progression of what [[Open-source persistent file formats]] started:
    - [[Parquet]] is no table format or is a file format. Something like properitery [[Data base Management systems|DBMS]] are using under the hood. But it does not have the feature set of a table in a DBMS.
    - Iceberg brings the table abstraction outside of the DBMS with features. Like transactions, partitioning, query planning optimizations, statistics. It is the logical step of unbundling what was previously bundled into a single DBMS system.
- maybe also use spark SQL for the high level view.
- On Hive:
    - First idea on this table abstraction, but limited scope. In the end it just holds the schema, location and partitioning columns. Here one can just drop parquet files and "register" them to a table. They do not have to follow a specific writing style.
    - At query time the engine would do the actual heavy lifting and scan all the file on the prefix.
    - Nowadays hive can also be used as a catalog of Iceberg tables.
- iceberg decided against creating a new catalog but pulled out lot of responsibility out of the catalog and hence reduced it's scope. In the end for iceberg a catalog is just store a pointer to a table and allow for atomic swaps.
    - This so similar to how parquet pulled out columnar storage, encoding and compression out of the DBMS.
    - This analogy I think is important. What make a true table format?!

## Log

### 2026-07-01
 - Can I just use the default derby for hive meta store to show what I want to do?
 - How do the compatibilities need to line up work spake, Hadoop, Hive?!
 - See https://medium.com/@malinda.ashan/configure-apache-hive-to-use-postgres-as-metastore-fae1703e29d5
 - See here for the configs: https://cwiki.apache.org/confluence/plugins/servlet/mobile?contentId=27362076#content/view/27362076 or check this: https://hive.apache.org/docs/latest/user/configuration-properties/

### 2026-07-04
done: Turn this into its own section.

Hive findings:
 - There are a lot of table. Most of no interset to me except:
    - TBLS: seems to contain the tables, but no schema.
    - TABLE_PARAMS: Continas infos like partition keys and schmea but specific for query engine used.
    - COLUMNS_V2: Hold the actual schema.
    - PARTITIONS: One row per partition.
    - PARTITION_KEYS: contains the partition keys for each table.
    - SDS: Seems to contain the prefixes for the data location. done: Why named SDS? -> Storage Descriptors.


Query to see things together:
```sql
SELECT
    t."TBL_NAME",
    c."COLUMN_NAME",
   c."TYPE_NAME"
FROM public."TBLS" as t
JOIN public."SDS" s
    ON t."SD_ID" = s."SD_ID"
JOIN public."COLUMNS_V2" c
    ON s."CD_ID" = c."CD_ID" 
ORDER BY c."INTEGER_IDX" ;
```

Usefull references:
 - https://analyticsanvil.wordpress.com/2016/08/21/useful-queries-for-the-hive-metastore/
 - https://www.datacadamia.com/_media/db/hive/hive_metastore_er_diagram.png

done: Create small ER Diagram here for the tables used.

The important part is what how a query engine uses the Hive Meta Store.
Imagine a query that looks like this:
```sql
select name, powers
from xmen
where birth_year = 1963 
```
The query engine can now "ask" the hive metastore on specific things.
First does the table `xmen` even exist.
This information is stored in the `TBLS` table.
Second, does this table contain the asked for columns, `name` and `powers`.
This information is stored in `COLUMNS_V2`, which is accessible for the specific table via the `SD_ID`, which links to an `CD_ID`.
(The naming means columnn descriptor aka schema. Schema is linked to storeage descriptors, which would in theory allow different partitions to have different schemas.)
Then it can check if the predicate filters on a a partitioned column by checking `PARTITION_KEYS` if the table has any partition columns.
In this case it does, which leads to checking the `PARTITIONS` table to filter only the needed partitions `SD_ID`.
Finally the `SD_ID`s can be used to look up the location of the partition sin the `SDS` table.
But note here, that this is only a prefix.

done: Explain the issue of list all files for prefix.

TODO: Move this insight to its correct place.
One fix for this would be to add antoher table that now stores one row for every file in every partition.
But then for every write, which could include hundreds of files, many rows must be changed.
This would introduce a lot more load on the meta store/database.
Iceberg avoids this by using immutable files, i.e. no need to manipulate metadata. Just write new.


## References 
 - https://lakefs.io/blog/metadata-management-hive-metastore-vs-aws-glue/

