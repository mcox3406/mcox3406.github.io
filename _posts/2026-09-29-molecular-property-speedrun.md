---
layout: post
title: "A molecular property prediction speedrun"
date: 2026-09-29
description: "One GPU. Unseen chemical families. How quickly can we learn molecular excited states?"
tags: [machine-learning, chemistry, benchmarks]
---

**How quickly can one GPU learn a molecule's electronic properties?** [Mol Speedrun](https://mcox3406.github.io/mol-speedrun/) is a small competition to find out, inspired by the compact experiments of [nanoGPT](https://github.com/karpathy/nanoGPT) and the time-to-quality race of [modded-nanogpt](https://github.com/KellerJordan/modded-nanogpt).

The task uses [QCDGE](https://www.nature.com/articles/s41597-024-03788-x): predict the lowest singlet and triplet excitation energies, their difference, and the singlet transition's absorption strength from molecular structure. These are computed quantum-chemistry labels. The starting model is a tiny bidirectional transformer over SMILES; fingerprints, graph networks, and other approaches are welcome.

![Distributions of singlet excitation energy and absorption oscillator strength in the training and validation cohorts.]({{ '/assets/posts/molecular-speedrun/cohort.svg' | relative_url }})

*308,402 training and 64,549 validation molecules. Absorption strengths span orders of magnitude, so the evaluator also checks stronger transitions separately.*

The rules are simple:

- **Reach all five error targets fastest**, on one L40S. Every prescribed seed must pass; rank by median time across three seeds.
- **Generalize across chemical families.** Scaffolds and connectivity families stay together. A separate rare-family audit checks transfer after the recipe is frozen.
- **Count the work.** Preprocessing, compilation, training, evaluation, and output files all go on the clock. Submit code and results through a pull request.

The fingerprint controls leave a useful accuracy gap, and the reference runs in minutes. The audit is a public, supplementary check—not a claim of universal chemical generalization.

**[Grab the code](https://github.com/mcox3406/mol-speedrun), download 11 MB of data, and try an idea.** The [dashboard](https://mcox3406.github.io/mol-speedrun/) has the targets, measured runs, and submission instructions.
