# SOVRA Content Safety Policy & Moderation Pipeline

## 1. Platform Policy & Core Principles

Sovra is dedicated to fostering a safe, healthy, and respectful decentralized social ecosystem.

### 1.1 Strict Sexual Content Prohibition

Sovra maintains a **strict platform prohibition against sexually explicit and sexually suggestive content**.

The following categories are strictly prohibited across all public feeds, profile avatars, banners, thumbnails, videos, images, and community spaces:

1. **Pornography & Explicit Sexual Acts:** Any visual depiction or live presentation of sexual intercourse, oral sex, masturbation, or sexual stimulation.
2. **Nudity for Sexual Display:** Unclothed or transparently clothed display of genitals, buttocks, or breasts intended for sexual display.
3. **Sexualized Poses & Body Framing:** Imagery composed deliberately to focus attention on sexual anatomy in an eroticized manner.
4. **Cleavage-Focused Sexualized Imagery:** Close-up or intentionally framed camera angles highlighting breast cleavage for sexualized appeal.
5. **Lingerie & Undergarment Focused Content:** Visuals centering on lingerie, underwear, or fetish wear presented in a sexually provocative context.
6. **Sexual Solicitation & Commercial Sex:** Promoting, advertising, or soliciting commercial sexual services, escort arrangements, or adult webcam platforms.
7. **Sexually Suggestive Thumbnails & Previews:** Deliberately deceptive or clickbait thumbnails displaying sexually suggestive framing to draw video views.
8. **Sexually Explicit AI-Generated Media:** Any synthetic or AI-rendered imagery, deepfakes, or digital illustrations depicting prohibited sexual acts or suggestive poses.

### 1.2 Vital Protection of Identity, Health & Orientation

> **CRITICAL DIRECTIVE:** The moderation system must strictly distinguish personal identity and civil discussion from explicit sexual material.

The following are **NOT** prohibited and must NEVER be flagged or suppressed under this policy:

- **Sexual Orientation & Gender Identity:** Discussion, self-identification, pride, and advocacy regarding LGBTQ+ identities, relationships, or history.
- **Medical & Anatomical Health Education:** Clinical diagrams, medical explanations of reproductive health, breastfeeding, postpartum health, or cancer screening documentation.
- **Consensual Artistic & Historical Works:** Classical art, non-erotic sculpture, and historical photography in appropriate cultural contexts.
- **Modest Fitness & Athletics:** Sports activities, competitive swimming, and athletic workouts without eroticized camera angles.

---

## 2. Multi-Stage Content Moderation Pipeline

Uploads flow through a multi-stage defense-in-depth pipeline to protect users, node operators, and the platform:

```
+----------------------------------------------------------------------------------------------------+
|                                    CONTENT UPLOAD PIPELINE                                         |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
                               +-------------------------------------+
                               |   Stage 1: Client Pre-Flight Scan   |
                               |  (Fast local heuristics & hashes)   |
                               +-------------------------------------+
                                                  |
                                                  v
                               +-------------------------------------+
                               |   Stage 2: Perceptual Hash Engine   |
                               |  (Known CSAM / PDQ / pHash Index)   |
                               +-------------------------------------+
                                                  |
                                                  v
                               +-------------------------------------+
                               |   Stage 3: Multi-Modal AI Analysis  |
                               |  - Visual Frame Extractor (Videos)  |
                               |  - Optical Character Recognition    |
                               |  - Text / Caption / Metadata NLP    |
                               +-------------------------------------+
                                                  |
                                                  v
                               +-------------------------------------+
                               |   Stage 4: Policy Scoring Engine    |
                               +-------------------------------------+
                                                  |
                   +------------------------------+------------------------------+
                   |                                                             |
         Score < 0.35 (Safe)                                           Score >= 0.85 (Violation)
                   |                                                             |
                   v                                                             v
             [ALLOW & PUBLISH]                                           [REJECT & BLOCK]
                   |                                                             |
                   +----------------------- 0.35 <= Score < 0.85 ----------------+
                                                  |
                                                  v
                                         [QUARANTINE / REVIEW]
                                                  |
                                                  v
                               +-------------------------------------+
                               |   Stage 5: Human Reviewer Console   |
                               |   (Admin Panel Staff Intervention)  |
                               +-------------------------------------+
```

### 2.1 Pipeline Stages Explained

1. **Stage 1 — Client Pre-Flight Check:**
   - Runs locally in the publisher's client before network transmission.
   - Computes perceptual hashes and performs lightweight on-device classification where device capabilities permit.
   - Provides immediate real-time feedback to creators if an asset triggers clear violation thresholds.

2. **Stage 2 — Perceptual Hash Matching (Known Violations):**
   - Extracts perceptual hashes (PDQ, PhotoDNA, pHash) from images and sampled video keyframes.
   - Cross-references against internal safety databases and public illegal material blocklists.
   - Zero-tolerance matches immediately trigger complete quarantine and law enforcement escalations where legally mandated.

3. **Stage 3 — Multi-Modal Deep Analysis:**
   - **Video Keyframe Analysis:** Extracts frames at regular intervals (1 frame per 2 seconds, plus scene-change keyframes).
   - **Visual Classification Model:** Evaluates nudity probability, sexualized pose classification, and body exposure ratio.
   - **OCR & Text Analysis:** Scans embedded on-screen text, overlaid watermarks, titles, and video descriptions.
   - **Context Classifier:** Assesses context to distinguish medical/identity discussions from sexual solicitation.

4. **Stage 4 — Policy Scoring Engine & Action Matrix:**
   - Combines weighted confidence scores across all modalities into an aggregate violation score $S \in [0.0, 1.0]$.
   - Action criteria:
     - **ALLOW ($S < 0.35$):** Asset is approved, assigned a CID, and published to the distributed network.
     - **QUARANTINE ($0.35 \le S < 0.85$):** Asset is held in quarantine. Not distributed to public explore/feed topics pending human staff review.
     - **REJECT ($S \ge 0.85$):** Upload rejected immediately. Diagnostic explanation provided to creator.

5. **Stage 5 — Human Review in Admin Console:**
   - Staff moderators in `apps/sovra-admin` review items in the Quarantine Queue.
   - Dual-reviewer consensus required for edge cases or verified creator sanctions.
   - Decisions generate tamper-evident signed moderation assertions.

---

## 3. Decentralized Moderation Primitives

In a decentralized network, no single server controls all data. Moderation operates through multiple distributed layers:

### 3.1 Three Tiers of Filtering

```
+----------------------------------------------------------------------------------------------------+
| 1. User Tier (Client-Side)                                                                         |
|    - Personal blocklists, mute lists, keyword filters, and sensitive content blur filters.         |
|    - Signed blocking events (`kind: 30`) inform client feed engines to suppress content locally.   |
+----------------------------------------------------------------------------------------------------+
| 2. Node / Community Tier (Server-Side)                                                             |
|    - Community Nodes and Relay Operators curate local pinning and relay policies.                  |
|    - Operators maintain local reputation lists and refuse to pin or relay violating CIDs.          |
+----------------------------------------------------------------------------------------------------+
| 3. Platform & Gateway Tier (Company-Operated Infrastructure)                                       |
|    - Company-hosted bootstrap relays, search indexers, and public web gateways apply platform      |
|      safety policies rigorously to comply with legal requirements and maintain brand safety.       |
+----------------------------------------------------------------------------------------------------+
```

### 3.2 Signed Moderation Assertions

Moderation actions taken by node operators or company moderators are recorded as verifiable cryptographic events:

```json
{
  "kind": 30,
  "pubkey": "moderator_ed25519_pubkey",
  "created_at": 1780000500,
  "tags": [
    ["e", "violating_event_id"],
    ["c", "bafybeic5...violating_cid"],
    ["action", "quarantine"],
    ["reason", "policy_sexual_explicit"],
    ["confidence", "0.94"]
  ],
  "content": "Automated classifier consensus confirmed by Moderator Staff #42",
  "sig": "ed25519_signature"
}
```

---

## 4. Appeals, Transparency & False Positive Telemetry

### 4.1 Appeals Workflow

1. **Submission:** If a creator's content is rejected or quarantined, they may submit an Appeal Event signed with their private key, detailing the rationale (e.g. educational context, artistic exemption).
2. **Review:** The appeal is routed to a dedicated Senior Reviewer queue in `apps/sovra-admin`.
3. **Resolution:** If granted, the quarantine is revoked, the CID is pinned, and the event is broadcast. If denied, a signed denial justification is recorded.

### 4.2 False-Positive Telemetry & Model Improvement

- Continuous monitoring of overturn rates per classifier model.
- Weekly false-positive audit sessions to adjust confidence thresholds.
- Retraining datasets with verified false-positive edge cases to prevent recurring misclassifications.
