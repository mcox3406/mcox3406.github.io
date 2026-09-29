---
layout: post
title: "A molecular property prediction speedrun"
date: 2026-09-29
description: "Borrowing nanoGPT's experimental discipline to ask whether local chemical memory buys us faster learning."
tags: [machine-learning, chemistry, benchmarks]
---

I want a molecular machine learning experiment that is small enough to run after lunch and interesting enough to keep improving. The question is simple: **how quickly can we train a model to predict a molecular property well?**

There is a second question hiding inside it. If we give a model cheap access to recurring local patterns, does it learn chemistry faster? And does it matter whether those patterns live in a SMILES string or in the molecular graph?

The starting point is [Mol Speedrun](https://github.com/mcox3406/mol-speedrun), a small companion repository. It is currently a private pilot: frozen data, a few baselines, and a static dashboard. This post is a proposal and a description of the initial implementation, not an announcement of a new state of the art.

## Borrow the rules first

There are two related projects worth distinguishing. Andrej Karpathy's [nanoGPT](https://github.com/karpathy/nanoGPT) makes transformer training approachable through compact code. Keller Jordan's [modded-nanogpt](https://github.com/KellerJordan/modded-nanogpt) turns training into a collaborative speedrun.

The latter fixes a language-modeling quality target and compares elapsed time on reference hardware. Its rules preserve the underlying train and validation token streams, require evidence across runs that the target is met, and compare a proposed speed improvement against the previous record on the same hardware. The published significance requirement is p < 0.01, with an exception for systems-only changes. It also restricts additional compiler configuration flags. Those are useful constraints because they define what counts as progress. See the [rules](https://github.com/KellerJordan/modded-nanogpt#rules).

For molecules, I would preserve that discipline while changing the prediction problem. Instead of next-token loss, predict a scalar property and report error in the property's units. The race should eventually be **time to a frozen validation RMSE**, with an independent test audit. The architecture can change. The molecules, labels, splits, and accounting cannot quietly change with it.

I would not select the target from the best result of the first experiment. First run reasonable baselines, establish a useful and attainable threshold, then freeze a versioned protocol before taking submissions.

## Start with a supervised encoder

My first model would be a small transformer over canonical SMILES, trained from scratch. Replace the vocabulary prediction head with a scalar regression head. Permit bidirectional attention: a property predictor gets to see the whole molecule. Mask padding, pool the token representations, and minimize mean squared error after standardizing labels using **training statistics only**. Convert predictions back to original units before scoring.

This is an adaptation of nanoGPT's compact experimental style, not a requirement to preserve GPT's causal mask or language-model objective. Pretraining would introduce another data budget and another clock. That is an interesting later track.

For the initial experiment, the repository uses two 64-dimensional transformer layers, a fixed ASCII character vocabulary, and mean pooling. That is intentionally modest. There is no reason to start with 124 million parameters on a thousand observations.

## A small dataset to debug the experiment

The pilot uses ESOL: 1,128 molecular solubility measurements distributed through [MoleculeNet/DeepChem](https://deepchem.readthedocs.io/en/stable/api_reference/moleculenet.html). The target is measured log₁₀ aqueous solubility in mol/L. Crucially, the source also contains an existing ESOL prediction and descriptors. Those columns do not enter the model.

The preparation script verifies the source checksum, canonicalizes SMILES with a recorded RDKit version, and assigns whole Bemis–Murcko scaffold groups to fixed train, validation, and test files. The resulting counts are 902, 113, and 113. Duplicate structures remain within one group. Acyclic molecules share the empty scaffold and stay together rather than being scattered across partitions.

This is a custom, documented split. It is not a reproduction of someone else's published ESOL score. Scaffold separation is also not a guarantee that chemically similar structures never cross the boundary. [MoleculeNet](https://doi.org/10.1039/C7SC02664A) is useful background for why dataset, split, and metric must be considered together.

ESOL is a good wiring test and a poor final arena for a hardware speed race. On a dataset this small, setup costs and validation composition can dominate. I would graduate to a larger task after the pipeline works. A selected QM9 property is one possible direction for quantum chemistry, but predicting a computed quantum property and predicting experimental solubility answer different scientific questions. The dataset should follow the question.

## Give the transformer some competition

The first comparison has five entries:

| Model | What it tests |
| --- | --- |
| Training-label mean | Is the pipeline beating a trivial predictor? |
| Morgan fingerprints + ridge regression | Does a cheap conventional representation already do the job? |
| Small SMILES transformer | What can the sequence model learn alone? |
| Transformer + hashed bigram memory | Do local string patterns help? |
| Transformer + pooled Morgan features | Does direct access to graph environments help? |

The string variant looks up a learned embedding from a hash of adjacent character IDs and adds it through a learned gate. The graph variant projects radius-two Morgan fingerprint bits into a learned vector and gates that vector into the pooled molecular representation.

That last variant is a useful first control, **not yet a clean string-versus-graph memory experiment**. The injection locations and parameter counts differ. A stronger follow-up would align graph environments to atom tokens, match memory capacity and compute, and compare where each representation is injected. I would also include a larger plain transformer as a capacity control.

## Why memory is worth testing

[MolGram, released in June 2026](https://arxiv.org/abs/2606.12113), augments molecular language models with gated, hashed local n-gram memory. Its experiments cover unconditional generation, forward reactions, and single-step retrosynthesis, with reported improvements over larger baselines. That makes local memory a credible hypothesis here; it does **not** establish a property-prediction benefit.

SMILES locality is partly chemical and partly grammatical. Branch punctuation and ring labels make string neighborhoods differ from graph neighborhoods. Even a familiar fragment needs context: `C(=O)O` can appear in an acid or an ester depending on what follows. Changing the traversal changes the string without changing the molecule.

[Morgan fingerprints](https://www.rdkit.org/docs/GettingStartedInPython.html#morgan-fingerprints-circular-fingerprints) offer graph-derived local environments instead. Learning embeddings for hashed environments is a natural extension, but not literally equivalent to every fingerprint model: radius, atom invariants, multiplicities, pooling, and collisions all matter. Hash collisions lose information. Their practical cost needs measurement, not an argument that common motifs make them harmless.

## What goes on the clock?

For this pilot, timing begins before reading the prepared CSVs and constructing model features. It includes model initialization, training, and every full validation pass. Downloads, Python imports, and environment installation are excluded. Preprocessing time is also reported separately. A future GPU implementation must synchronize devices and report peak memory before its times count as records.

That prevents graph featurization or a compiled model from becoming an invisible subsidy. A later protocol might permit a shared cache, but its contents would need to be fixed for everyone.

The dashboard currently shows individual exploratory runs and learning curves. It does not award records. Speed comparisons require matching hardware, thread counts, and software, plus rerunning the baseline on that machine. The initial short runs establish that the code works; they do not settle which model is best.

For substantive comparisons, use a prespecified seed panel and report every run. Once a target is frozen, failures to reach it must remain visible. A one-sided 99% confidence bound could be part of a qualification rule, but we need to prescribe the sample size and checkpoint procedure before racing. Adding seeds until a p-value looks favorable is not that procedure. Seed variability also says nothing by itself about uncertainty across chemical space.

The public test file is reserved by convention; the trainer never uses its labels. It is not a hidden evaluation service. Before a serious benchmark release, finalists need a separate audited test evaluation and eventually replication across additional splits. Repeated optimization against public validation data can overfit the benchmark even when no code directly trains on it.

## Keep the infrastructure boring

A submission is a pull request containing the implementation, exact command, environment information, and run JSONs. A small script validates those files and rebuilds an HTML dashboard. CI checks the split and result contracts; a maintainer still needs to reproduce any claim. There is no account system, database, or automatic execution of untrusted submissions on expensive hardware.

The immediate goal is an afternoon experiment: get the fingerprint baseline working, run the small transformer, then add one memory mechanism at a time. If a ridge model wins on both speed and error, that is a useful result. If a memory table helps, the next question is whether it helps because of chemistry, extra capacity, or easier optimization. A good speedrun should make those questions easier to ask.
