+++
title = "Data alignment restriction"
date = 2026-03-09
+++

Data alignment restriction means that many modern computer place restrictions on the allowable addresses for <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Primitive data types</span>.
They require that the addresses must be a multiple of some value $K$.
This is used, because it simplifies the design of the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Hardware</span>.

An example of this is, that if a <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Central processing unit (CPU)</span> always fetches 8 <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Byte</span> from memory with an address that must be a multiple of 8.
Then if a `double` abides this alignment restriction always only one access is necessary.
But if it does not, two accesses are necessary to get the two parts of the double.

In the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">x86-64</span> architecture a Programm will work correctly even without data alignment.
But it is recommended to use it to improve performance.
For the following primitive types these multiple $K$ are used:

| K | Types                     |
|---|---------------------------|
| 1 | char                      |
| 2 | short                     |
| 4 | int, float                |
| 8 | long, double, char *      |

The alignment restriction is enforced by making sure that every data type is organized in such a way, that ever object within it satisfies the alignment restriction.
This means that e.g. for <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Structure</span> the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Compiler</span> must insert gaps of <span style="color: #a3be8c; font-weight: 500; font-style: italic;">byte</span>s.

For example for this structure:
```C
struct S1 {
    int i;
    char c;
    int j;
};
```
One must use the offsets:
{{ image(src="/images/alignment-example.jpg", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;width: 850px") }}

Additionally the end of a structure may need to be padded, so that if one declares an <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Array</span> of structures the data alignment restriction still holds.


## References 
 - Computer Systems A Programmer's Perspective
