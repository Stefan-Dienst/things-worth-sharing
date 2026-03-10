+++
title = "UTF-8 Encoding"
date = 2026-03-09
+++

UTF-8 is a, <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Text file</span> encoding that stands for 8-bit UCS transformation format.
(Here UCS stands for Universal Character Set which is another name for <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Unicode</span>.)

The key idea of UTF-8 is that in can represent all available characters of <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Unicode</span> while also read <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Text file</span>s that were originally encoded in <span style="color: #a3be8c; font-weight: 500; font-style: italic;">ASCII</span>.
It does this by forming a form of superset of the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">ASCII</span> encoding.
If a <span style="color: #a3be8c; font-weight: 500; font-style: italic;">byte</span> starts with a 0 it is interpreted as a plain <span style="color: #a3be8c; font-weight: 500; font-style: italic;">ASCII</span> character.
If it starts with a 1 it represents a non-ASCII character.
Those non-ASCII characters are represented as multi byte characters, as <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Unicode</span> needs 21 bits at the moment.
This way, while <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Unicode</span> and <span style="color: #a3be8c; font-weight: 500; font-style: italic;">ASCII</span> use different number of bits UTF-8 makes them compatible.
In addition to not waste space, the most common Western characters are stored using fewer bytes.

## References 
 - [https://manderc.com/concepts/ascii/index_eng.php](https://manderc.com/concepts/ascii/index_eng.php)


