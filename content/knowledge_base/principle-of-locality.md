+++
title = "Principle of Locality"
date = 2026-03-09
+++

The principle of Locality states that well-written programs should reference data items that are near other recently referenced data items or that were recently referenced themselves.
Here one differentiates between two forms:
 1. **Spatial Locality**: Here the program is likely to reference a nearby memory location in the future.
 2. **Temporal Locality**: A memory location that is referenced once is likely to be referenced again multiple times in the future.

In general one can say, that programs with good Locality run faster than programs with poor Locality.
This is because of the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Memory hierarchy</span> in modern <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Computer</span>s, where it is ensured, that data that has been recently used or is close together is higher in their hierarchy.


## Examples
 - <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Cache memories</span> hold the most recently referenced <span style="color: #a3be8c; font-weight: 500; font-style: italic;">instructions</span> and data items for the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">CPU</span>.
 - The <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Operating System</span> uses the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">RAM</span> as a <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Cache</span> for the most recently used <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Virtual Address</span> <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Space</span>.
 - The <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Operating System</span> uses the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">RAM</span> as a <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Cache</span> for the most recently used <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Disk</span> blocks.
 - Web browser cache recently viewed documents on a local disk.
 - Web servers <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Cache</span> recently requested documents.


## References 
 - Computer Systems A Programmer's Perspective
