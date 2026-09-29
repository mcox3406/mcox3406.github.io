---
layout: post
title: "A molecular property prediction speedrun"
date: 2026-09-29
description: "One GPU. Unseen chemical families. How quickly can we learn molecular excited states?"
tags: [machine-learning, chemistry, benchmarks]
---

**How quickly can one GPU learn to predict a molecule's electronic properties?** I'm building a small competition to find out, borrowing the compact experiments of [nanoGPT](https://github.com/karpathy/nanoGPT) and the time-to-quality race of [modded-nanogpt](https://github.com/KellerJordan/modded-nanogpt).

The candidate task uses [QCDGE](https://www.nature.com/articles/s41597-024-03788-x): predict the lowest singlet and triplet excitation energies, their difference, and the singlet transition's absorption strength from molecular structure. These are computed quantum-chemistry labels. The starting model is a tiny bidirectional transformer over SMILES; fingerprints, graph networks, and other approaches are welcome.

![Distributions of singlet excitation energy and absorption oscillator strength in the training and validation cohorts.]({{ '/assets/posts/molecular-speedrun/cohort.svg' | relative_url }})

*Development-cohort distributions; the reserved families are excluded. Absorption strengths span orders of magnitude, so we also check performance on stronger transitions.*

The proposed race is straightforward:

- **Reach fixed error targets fastest**, on one reference GPU. Aim for a useful starting run in 10–60 minutes.
- **Generalize across chemical families.** Keep related scaffolds and connectivity families together, with a separate chemical holdout for tuning.
- **Make results reproducible.** Freeze the data and evaluator, count submission-specific preprocessing and compilation, and verify records across seeds. Submit code and logs through pull requests to a simple leaderboard.

I'm calibrating the full cohort against cheap baselines before freezing the targets. A competition that atom counts or a quick fingerprint model can trivialize would miss the point. Equally, difficulty should come from useful chemical generalization, not unreliable labels.

The [prototype repository](https://github.com/mcox3406/mol-speedrun) is currently private; thresholds and the final test protocol are still in development. The goal is a small experiment people can improve in an afternoon.
