+++
title = "Single instruction multiple data (SIMD)"
date = 2026-03-09
+++

Single instruction multiple data (SIMD) describes a class of <span style="color: #a3be8c; font-weight: 500; font-style: italic;">CPU</span> operations that allow to perform the same operation on multiple data at the same time.
The counterpart is single instruction single data (SISD).
All modern <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Instruction set architecture (ISA)</span> support SIMD operations.

In the <span style="color: #a3be8c; font-weight: 500; font-style: italic;">numpy</span> library of <span style="color: #a3be8c; font-weight: 500; font-style: italic;">python</span> array operations use SIMD to process data simultaniously instead of each value of <span style="color: #a3be8c; font-weight: 500; font-style: italic;">Array</span> after another. This is also often called a vectorized Operation. Therefore due to SIMD a vectorized operation is faster than an explicit loop.

## References
 - [Blog post](https://laurenar.net/posts/python-simd/)
 - Andy Pavlo Advanced Database Systems
