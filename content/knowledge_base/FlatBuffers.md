+++
title = "FlatBuffers"
date = 2026-03-09
+++

Flatbuffers is an efficient <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Serialization Framework</span> created by <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Google</span>.
**It's key advantage over other <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Serialization Framework</span>s is that one can access data directly without unpacking or parsing the whole <span style="color: #a3be8c; font-weight: 500; font-style: italic;">serialized</span> object, i.e. [zero-copy](@/knowledge_base/zero-copy.md) access.**
It offers support for many <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Programming languages</span> including <span style="color: #a3be8c; font-weight: 500; font-style: italic;">C</span>, <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Rust</span>, <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Kotlin</span> and <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Python</span>.

## How does it work
To use flatbuffers one needs to define a schema, for example:
```fbs
table Monster {
  name:string;
  health:int;
}

root_type Monster;
```

This can then be used to automatically create the boiler plate code serialize an object and "deserialize", i.e. directly access specific data of it.
To make this work when one serializes a flatbuffer object one in facts creates a binary buffer that uses offsets to organize nested structure.
This way one can just "jump to the point" in the buffer where the desired Data field is by using an offset.

Note here, that the serialization effort is higher for flatbuffers than e.g. for <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Protocol Buffer</span>.
So flatbuffers may be at a disadvantage for write heavy workloads.


## References 
 - [https://flatbuffers.dev/#protocol-buffers](https://flatbuffers.dev/#protocol-buffers)
