---
status: reference
type: concept
title: Fourier Transform
tags:
- concept
- mathematics
- signal-processing
---

# Fourier Transform

Decomposes a function into its constituent frequencies.

## Definition

For a continuous signal $f(t)$, the Fourier transform is:

$$\hat{f}(\omega) = \int_{-\infty}^{\infty} f(t) \, e^{-i\omega t} \, dt$$

The inverse transform recovers the original signal:

$$f(t) = \frac{1}{2\pi} \int_{-\infty}^{\infty} \hat{f}(\omega) \, e^{i\omega t} \, d\omega$$

> [!note] Notation
> Different fields use different conventions for the $2\pi$ factor. Physics typically puts it in the inverse transform; signal processing splits it as $\frac{1}{\sqrt{2\pi}}$ on both sides.

## Discrete Version

For sampled data with $N$ points:

$$X_k = \sum_{n=0}^{N-1} x_n \, e^{-2\pi i k n / N}$$

> [!tip] FFT Complexity
> The naive DFT is $O(N^2)$. The Fast Fourier Transform (Cooley-Tukey algorithm) reduces this to $O(N \log N)$, making real-time audio processing practical.

## Key Properties

| Property | Time Domain | Frequency Domain |
|----------|------------|-----------------|
| Linearity | $af(t) + bg(t)$ | $a\hat{f}(\omega) + b\hat{g}(\omega)$ |
| Time shift | $f(t - t_0)$ | $e^{-i\omega t_0} \hat{f}(\omega)$ |
| Convolution | $(f * g)(t)$ | $\hat{f}(\omega) \cdot \hat{g}(\omega)$ |

> [!important] Convolution Theorem
> Convolution in the time domain equals multiplication in the frequency domain. This is why filtering is done in frequency space — it turns an $O(n^2)$ convolution into $O(n \log n)$ via FFT.

## Connections

The transform relies on [[Euler Formula|Euler's formula]] ($e^{i\omega t} = \cos(\omega t) + i\sin(\omega t)$) to decompose signals into sinusoidal components.

[[Bob Jones]] applied Fourier analysis to the [[Widget Theory]] state propagation model, showing that observable changes decompose into a finite basis of frequency modes.

> [!failure] Failed Approach
> We tried using wavelets instead of Fourier basis for the [[Acme Project]] signal pipeline, but the non-orthogonality of our chosen wavelet family caused numerical instability at $N > 10^4$ samples.
