---
title: Euler's Formula
tags:
- concept
- mathematics
status: reference
type: concept
related:
- '[[Concepts/Widget Theory]]'
---

# Euler's Formula

The most beautiful equation in mathematics, connecting five fundamental constants:

$$e^{i\pi} + 1 = 0$$

## The General Form

Euler's formula states that for any real number $x$:

$$e^{ix} = \cos(x) + i\sin(x)$$

This bridges exponential functions and trigonometric functions through complex analysis.

## Derivation Sketch

Starting from the Taylor series expansions:

$$e^{ix} = \sum_{n=0}^{\infty} \frac{(ix)^n}{n!} = 1 + ix - \frac{x^2}{2!} - \frac{ix^3}{3!} + \frac{x^4}{4!} + \cdots$$

Separating real and imaginary parts gives us $\cos(x)$ and $\sin(x)$ respectively.

> [!tip] Geometric Intuition
> Think of $e^{ix}$ as tracing a unit circle in the complex plane. At angle $x$, the point lands at $(\cos x, \sin x)$.

## Applications

The formula underpins signal processing, quantum mechanics, and [[Widget Theory]]'s harmonic decomposition.

> [!note] Connection to Widget Theory
> [[Alice Smith]] showed that widget composability follows from the multiplicative property $e^{i(a+b)} = e^{ia} \cdot e^{ib}$, which is a direct consequence of Euler's formula.

See also the [[Fourier Transform]] for the applied version of these ideas.
