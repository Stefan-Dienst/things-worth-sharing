+++
title = "Zero-copy"
date = 2026-03-09
+++

Zero-copy is a concept in which unnecessary copies when transferring data are eliminated.
For example when reading data from <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Disk</span> and moving data over the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Network</span> multiple times the data is copied to different buffers, e.g. Kernel space to use space.
This all can be eliminated if the Kernel just directly moves the data to the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Network Interface Card</span>.

The name zero copy refers here to that no copies to <span style="color: #a3be8c; font-weight: 500; font-style: italic;">User space</span> are done.
There <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Kernel</span> still has to copy the data.

Other example:
 - <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Remote Direct Memory Acces</span>.

## Example 
Using `os.sendfile` in <span style="color: #a3be8c; font-weight: 500; font-style: italic;">python</span> to use zero copy.


```python
import socket
import os

# Create a TCP socket
server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server_socket.bind(('0.0.0.0', 9000))
server_socket.listen(1)

print("Waiting for a connection...")
conn, addr = server_socket.accept()
print(f"Connected by {addr}")

# Open the file to send
file_path = "large_file.dat"
with open(file_path, "rb") as f:
    # Use os.sendfile to transfer the file directly from disk to socket
    offset = 0
    file_size = os.fstat(f.fileno()).st_size
    while offset < file_size:
        sent = os.sendfile(conn.fileno(), f.fileno(), offset, file_size - offset)
        offset += sent

conn.close()
server_socket.close()
```
