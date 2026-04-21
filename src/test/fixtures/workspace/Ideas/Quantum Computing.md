---
title: Quantum Computing Notes
tags:
- idea
- physics
- computing
status: draft
type: idea
aliases:
- QC
- quantum
---

# Quantum Computing Notes

## Qubit Basics

A classical bit is either 0 or 1. A qubit exists in a superposition:

$$|\psi\rangle = \alpha|0\rangle + \beta|1\rangle$$

where $\alpha$ and $\beta$ are complex amplitudes satisfying $|\alpha|^2 + |\beta|^2 = 1$.

> [!info] Dirac Notation
> The $|0\rangle$ and $|1\rangle$ symbols are called "kets" — they represent column vectors in a 2D Hilbert space.

## Quantum Gates

The Hadamard gate creates equal superposition:

$$H = \frac{1}{\sqrt{2}} \begin{pmatrix} 1 & 1 \\ 1 & -1 \end{pmatrix}$$

Applying $H$ to $|0\rangle$ gives $\frac{1}{\sqrt{2}}(|0\rangle + |1\rangle)$.

> [!warning]- Common Misconception
> Measurement is irreversible. Once you observe a qubit, the superposition collapses. You cannot "undo" a measurement — this is fundamentally different from classical reversible computing.

> [!tip]+ Useful Identity
> For any unitary $U$, we have $U^\dagger U = I$. This means quantum gates are always invertible, which is why quantum circuits are reversible (measurement aside).

## Entanglement

Two qubits can be entangled via a CNOT gate after Hadamard:

$$|\Phi^+\rangle = \frac{1}{\sqrt{2}}(|00\rangle + |11\rangle)$$

This is one of the four Bell states. Measuring one qubit instantly determines the other, regardless of distance.

> [!quote] Einstein on Entanglement
> "Spooky action at a distance." — While Einstein intended this as a criticism, experiments have confirmed that entanglement is real and non-local.

## Relevance to Our Work

[[Alice Smith]] suggested that the [[Widget Theory]] composability axioms mirror the tensor product structure of multi-qubit systems. If true, the [[Gadget Pattern]] could be generalized to quantum-resistant protocols.

> [!bug] Parser Issue
> The math renderer chokes on nested `\begin{aligned}` environments inside display math. Filed as a known limitation.

See [[Euler Formula|Euler's Formula]] for the mathematical foundation connecting $e^{i\theta}$ to quantum phase rotations.
