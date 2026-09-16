# Smile design research — the rules behind the DSD module

Written 2026-09-16 as groundwork for the DSD / smile-makeover add-on. This is the
knowledge the prompt builder and the design editor are built from. Plain language on
purpose; the numbers are the point.

---

## 1. Why AI smile mockups look fake — and how we stop it

Patients say "too white", but dentists who fix failed cases say colour is almost never the
real problem. The real causes, in order of how often they turn a patient off:

| Cause | What the eye sees |
|---|---|
| **Chiclet uniformity** | Every tooth the same size, shape and finish. Looks manufactured, not grown. |
| **No translucency** | Opaque, flat white. Real enamel lets light through at the edges. |
| **No surface texture** | High-gloss plastic. Real teeth have micro-ridges that catch light unevenly. |
| **Wrong proportions** | Centrals not dominant, laterals same size as centrals, canines turned into incisors. |
| **Too long / too bright** | Teeth extended past the lip line, or a BL1 "ultra white" applied by default. |
| **Face drift** | The AI regenerates the whole picture: lips, skin, eyes change slightly. The patient senses "that's not me". |
| **Lips and gum redrawn** | Lip line lifted, buccal corridor filled in, gum pinkened. A clinical audit of an AI simulator found predicted smiles were **more optimistic on lip line and smile arc than the real result** — exactly the overpromise that causes complaints later. |
| **Closed embrasures** | No dark triangles between the tips; a solid white wall. |

### The fix stack (all of these, not one)

1. **Design first, render second.** The dentist's outline (Option B) decides the shape of
   every tooth. The AI is only allowed to *paint* inside shapes it is given. It never
   invents the teeth.
2. **Edit only the mouth.** Two ways, used together:
   - Mask-based inpainting (Google Imagen 3 "capability" model on Vertex AI supports a
     true mask; Gemini's image model only takes a text instruction and re-imagines the
     whole photo).
   - Client-side compositing: whatever comes back, we paste **only the teeth region** onto
     the original photo, using the mouth mask from the face-landmark model. Lips, skin,
     eyes stay pixel-identical. This alone kills "that's not me".
3. **Natural by default.** Shade is a choice from the VITA guide, default A1/B1 ("natural
   bright"); BL shades only when chosen. Translucent incisal third, subtle surface texture,
   embrasures that open toward the canines, dominant centrals, canines pointed and slightly
   warmer in colour, a hair of asymmetry.
4. **Never touch what the dentist can't change.** No lip movement, no buccal-corridor fill,
   no gum change unless "gum reshaping" is explicitly part of the plan.
5. **Character chosen by the dentist and patient**, not by the model (section 4).
6. **Realism QA before the patient sees it.** Automatic check that everything outside the
   mask is unchanged; dentist approves; a permanent "simulation, not a promise" stamp in
   Arabic and English.
7. **Show two, not one.** "Natural bright" and "Brighter" side by side. Choice beats a
   single shot the patient must accept or reject.

---

## 2. Proportion systems — the numbers

Widths are what you see from the front (the visible width), not the real tooth width.

| System | Rule | Where it stands |
|---|---|---|
| **Golden proportion** (Lombardi / Levin) | Lateral = 62% of central; canine = 62% of lateral (1.618 : 1 : 0.618) | Found in only **14–25%** of natural smiles. Applied blindly it gives very wide centrals and thin canines — one of the "fake" looks. Good as a *Hollywood* option, not a default. |
| **RED proportion** (Ward) | The same ratio repeats tooth to tooth as you go back. **70%** for normal-length teeth, **62%** for tall teeth, **80%** for short teeth. Dentists in studies preferred the 70% version. | Flexible, tied to tooth length. Good default for "Natural". |
| **Preston proportion** | Lateral = **66%** of central; canine = **84%** of lateral | Closest to what natural dentitions actually measure. |
| **Golden percentage** (Snow) | Each tooth as a % of the canine-to-canine width. Theory: 25 / 15 / 10 (central / lateral / canine, each side). Measured populations: ~**22 / 15 / 13**. | Useful for checking symmetry left vs right; the percentages need adjusting per population. |

### Regional numbers (no Egyptian study found — Saudi and Jordanian used as the nearest proxy)

- Saudi adults 20–30, mean visible widths: **central 8.74 mm, lateral 6.64 mm, canine 7.82 mm**
  (men slightly wider than women). Measured ratio 1.52 : 1 : 0.60 — narrower centrals and
  canines than the golden ratio.
- Jordan: golden proportion between central and lateral present in only ~30% of people.
- Measured RED in an African population: lateral/central ~69%, canine/lateral ~83% — i.e.
  the ratio is *not* constant, it grows toward the back. Preston fits better than RED there.

### Size and shape of the central incisor

- Length **10–11 mm**, width ~8.5 mm, **width-to-length 75–80%**. Below 70% looks long and
  narrow; above 85% looks short and square.
- Central length also comes from the face: the design app scales the centrals to the
  inter-pupil distance and the face height, then checks the ratio.

### Our defaults

- **"Natural"** = Preston (66% / 84%), ratio 78%. This is what we start every case with.
- **"Balanced"** = RED 70%.
- **"Hollywood"** = Golden proportion, ratio 80%, wider centrals. Offered because the
  Egyptian market asks for it, never applied silently.

---

## 3. The smile analysis checklist (what the editor measures)

Macro (face) → mini (smile) → micro (each tooth). Target values, as agreed across the
literature:

**Face**
- Horizontal reference: line through the pupils. Vertical: facial midline (glabella –
  nose tip – chin).
- **Dental midline** should sit on the facial midline; up to ~2 mm off is unnoticed by lay
  people. A *tilted* midline is noticed sooner than a shifted one.
- **Incisal plane cant**: should be parallel to the pupil line. A few degrees is
  tolerated; beyond ~5° people see it.

**Smile**
- **Incisal display at rest** (lips relaxed, slightly open): ~3.5 mm for a young person;
  decreases with age; women show more than men.
- **Gingival display** on full smile: **1–2 mm ideal**; 3 mm+ reads as "gummy" to
  dentists; lay people tolerate up to ~4 mm.
- **Smile line / smile arc**: the curve of the upper tooth edges should follow the curve of
  the lower lip (a "consonant" arc). Flat arcs look older and masculine.
- **Buccal corridor**: the small dark space at the corners. Keep a little; filling it
  completely is a classic AI/fake-veneer tell.
- **Lip line**: average smile shows 75–100% of the upper front teeth; low shows less than
  75%; high shows gum.

**Tooth**
- **Gingival zeniths** (highest gum point on each tooth): centrals and canines level;
  laterals **0.5–1 mm lower**; the zenith sits slightly toward the back of each tooth's
  centre line.
- **Contact points** move up (toward gum) as you go back: the **50-40-30 rule** — the two
  centrals touch along ~50% of their length, central-lateral ~40%, lateral-canine ~30%.
- **Incisal embrasures** (dark triangles between the tips) get **bigger** from centrals to
  canines.
- **Axial inclination**: crowns tilt very slightly toward the back, more so on the canines.
- **Colour gradient**: centrals brightest, laterals a touch less, canines warmer/more
  saturated. Everything the same shade looks fake.
- **Surface**: light texture, translucent incisal third, and for young patients faint
  mamelons (the little lobes at the edge).

---

## 4. Character: what the dentist and patient choose together

This is the part that makes the smile *theirs*. The choice list is the input to the design
and to the render prompt.

### 4a. Shape family
- **Square** — flat edges, minimal rounding. Bold, defined, "strong".
- **Ovoid / soft square** — some straight, some curve. Balanced, the most versatile.
- **Tapered / triangular** — narrows toward the gum. Delicate, slender.
- A UK survey found the **tapered-ovoid** central the most attractive to ~50% of people,
  ahead of every other shape.

### 4b. Feminine ↔ masculine expression (a slider, not a gender check)
From the classic "dynesthetic" work (Frush & Fisher) and Lombardi. The patient decides
where they want to sit; we do not assume from their sex.

| Softer / feminine | Bolder / masculine |
|---|---|
| Rounded incisal corners | Square incisal corners, prominent line angles |
| Open incisal embrasures | Closed, small embrasures |
| Curved smile arc, laterals a bit shorter | Flatter incisal edge |
| Laterals slightly rotated / tucked behind the centrals | Laterals face straight forward |
| Softened line angles, gentle neck | Fuller cervical third, less taper |
| Smaller, more delicate laterals | Laterals closer in size to the centrals |

### 4c. Age expression
- **Youthful**: long dominant centrals, translucent edges, faint mamelons, curved arc, more
  tooth showing at rest, bright value.
- **Mature / natural for age**: shorter centrals, flatter edges with a hint of wear, less
  display at rest, warmer shade, less translucency.

### 4d. Visagism (personality → tooth design), Paolucci 2012
Four temperaments; the patient answers a short questionnaire or simply picks a card.

| Temperament | Personality words | Central shape | Long axes | Embrasure line |
|---|---|---|---|---|
| **Strong** (choleric) | determined, intense, passionate | Dominant **rectangular** | vertical | horizontal from central to lateral |
| **Dynamic** (sanguine) | extroverted, enthusiastic, communicative | **Triangular / trapezoid** | slight tilt back | rises away from the midline |
| **Sensitive** (melancholic) | organised, perfectionist, reserved | **Oval** | tilted back | falls away from the midline (soft inverted plane) |
| **Peaceful** (phlegmatic) | calm, discreet, spiritual | **Square, smaller** centrals | vertical | straight |

The research questionnaire is 37 yes/no questions; for the clinic we use a 6–8 question
version, or four picture cards the patient points at. The answer becomes a starting
template the dentist can still edit.

### 4e. Shade
| Label in the app | VITA shade | What it is |
|---|---|---|
| Natural | A2 / A1 | Real tooth colour, cleaned |
| Natural bright | **B1 / A1** | Lighter than natural but believable — recommended default |
| Hollywood | BL2 | Ultra-white, the Egyptian/Gulf market's usual request |
| Ultra | BL1 | Cinematic; warn that it reads as veneers |

Preview always renders **Natural bright** next to whatever the patient chose.

### 4f. Gum
- Leave as is (default).
- Gum reshaping (crown lengthening / gummy-smile correction) — only then may the render move
  the gum line, and only by the measured amount.

---

## 5. How the choices become a design and a prompt

```
photo ──▶ face landmarks (pupils, midline, lips)      free, in the browser
      ──▶ tooth outline proposal                      proportion system × face size × shape family
      ──▶ dentist adjusts each tooth                  editor
      ──▶ render request = { outline mask, choices }  ──▶ image model (masked)
      ──▶ composite teeth-only onto original          client
      ──▶ QA + dentist approval + stamp               ──▶ patient sees two variants
```

### Prompt skeleton (built from the choices, never free-typed)

> Repaint ONLY the upper front teeth inside the supplied mask; every pixel outside the mask
> stays identical. Follow the supplied outlines exactly for tooth shape, length and edge
> position. Shape family: {ovoid}. Expression: {softer — rounded incisal corners, open
> embrasures increasing toward the canines}. Age: {youthful — faint mamelons, translucent
> incisal third}. Shade {B1}: centrals brightest, laterals slightly less, canines warmer.
> Natural enamel: subtle surface texture, no gloss, no uniform white, slight translucency at
> the edges, teeth not identical to each other. Keep the lips, gum line, buccal corridor,
> skin and lighting exactly as in the original. Photorealistic, no retouching elsewhere.

Each `{…}` is filled from section 4. The dentist never has to write anything.

### What the render must never do (checked automatically)
- Change anything outside the mask (pixel diff must be ~0).
- Extend teeth past the outline.
- Change the gum unless gum reshaping was chosen.
- Apply a shade the dentist did not pick.

---

## 6. Sources

Proportions and evidence
- [Evaluation of natural smile: Golden proportion, RED or Golden percentage (PubMed)](https://pubmed.ncbi.nlm.nih.gov/20142879/)
- [Proportional Smile Design using RED and face size (ScienceDirect)](https://sciencedirect.com/science/article/abs/pii/S001185321500018X)
- [Using the RED Proportion to Engineer the Perfect Smile (Dentistry Today)](https://www.dentistrytoday.com/using-the-red-proportion-to-engineer-the-perfect-smile/)
- [Smile Design By The Numbers (Oral Health Group)](https://www.oralhealthgroup.com/features/smile-design-by-the-numbers/)
- [Golden Proportion, Golden Percentage and RED in Kenyans (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11226540/)
- [Maxillary anterior teeth dimensions in a Saudi subpopulation (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S1658361220302109)
- [Golden Proportion in Saudi individuals with natural smiles (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S1013905218304358)
- [Smile aesthetics in Pakistani population (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10979575/)
- [Different tooth proportions via DSD and perceived esthetics (JERD 2024)](https://onlinelibrary.wiley.com/doi/abs/10.1111/jerd.13164)

Smile analysis values
- [Smile Analysis: Diagnosis and Treatment Planning (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0011853222000179)
- [The eight components of a balanced smile (JCO)](https://www.jco-online.com/archive/2005/03/155-overview-the-eight-components-of-a-balanced-smile/)
- [Aesthetic Smile Designing (IntechOpen)](https://www.intechopen.com/chapters/86424)
- [Perception of smile esthetics by laypeople of different ages (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5357618/)
- [Gingival display and smile attractiveness, Saudi laypersons (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10618470/)
- [Influence of incisal embrasures on smile aesthetics (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12502746/)
- [Determining gingival margin position (Dental Economics)](https://www.dentaleconomics.com/science-tech/cosmetic-dentistry-and-whitening/article/55322565/determining-gingival-margin-position)

Character, gender, age, visagism
- [Correlation between dentofacial esthetics and mental temperament — Visagism (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5863416/)
- [Visagism: The Art of Dental Composition (Paolucci et al.)](https://www.semanticscholar.org/paper/Visagism:-The-Art-of-Dental-Composition-Paolucci-Calamita/c050178dd17e48911f312de471842b73b99a49ae)
- [Visagism in Dentistry: literature review (ResearchGate)](https://www.researchgate.net/publication/371158246_Visagism_in_Dentistry_Psychosocial_approach_of_smile_esthetics_A_literature_review)
- [How does gender affect smile design? (Dentistry.co.uk)](https://dentistry.co.uk/2024/06/27/how-does-gender-affect-smile-design/)
- [Gendered smile design (Charismatic Dental Laboratory)](https://charismaticdl.com/10-things-you-need-to-know-about-gendered-smile-design-in-aesthetic-dentistry/)
- [Complete denture aesthetics revisited — Frush & Fisher, Lombardi (CDA)](https://issuu.com/cdapublications/docs/issuu_051321_inprogress/s/12289511)
- [What teeth shape is most attractive (tapered-ovoid survey)](https://doctoryazmin.com/most-attractive-teeth-shape/)
- [Tooth shapes guide (Dental Crown Studio)](https://www.dentalcrownstudio.com/tooth-shapes/)

Why AI / veneers look fake
- [Clinical audit of an AI smile simulation system — prospective trial (Scientific Reports 2024)](https://www.nature.com/articles/s41598-024-69314-6)
- [Emotional impact of AI-simulated smiles on orthodontic patients (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12759262/)
- [Why Veneers Look Fake: Dentist Explains](https://www.aestheticsmilereconstruction.com/2026/02/20/why-do-veneers-look-fake/)
- [No More Chiclet Teeth](https://www.drpalluck.com/no-more-chiclet-teeth-the-secret-to-real-looking-veneers/)
- [Why do some veneers look fake or unnatural (Alma Dental)](https://almadentalcare.com/blog/natural-looking-veneers/)

Shades
- [VITA classical A1–D4 with Bleached Shades](https://vitanorthamerica.com/en-US/VITA-classical-A1-D4-shade-guide-with-VITA-Bleached-Shades-124.html)
- [A1 vs B1 tooth colour](https://turkeyluxuryclinics.com/en/blog/a1-vs-b1-tooth-color)
- [Hollywood smile trends 2026: natural vs ultra-white](https://cinikdental.com/blog/hollywood-smile-trends-in-2026-natural-versus-ultra-white)

Image-model mechanics
- [Mask-based inpainting with Imagen (Vertex AI docs)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/samples/generativeaionvertexai-imagen-edit-image-inpainting-insert-mask)
- [Insert objects into images using Imagen (Firebase AI Logic)](https://firebase.google.com/docs/ai-logic/edit-images-imagen-insert-objects)
- [Introducing Gemini 2.5 Flash Image (Google Developers Blog)](https://developers.googleblog.com/introducing-gemini-2-5-flash-image/)
- [How to make Gemini not change your face](https://www.media.io/ai-image-generator/fix-gemini-face-change.html)
- [Gemini prompts that keep subject identity consistent](https://sider.ai/blog/ai-tools/how-to-write-gemini-prompts-that-keep-subject-identity-consistent-across-edits)
