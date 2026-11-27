# Planet Generator 3D

**[English](#en) · [Oʻzbekcha](#uz) · [Русский](#ru)**

Real-time procedural planets in the browser. Three.js r170, hand-written GLSL, and not a single
texture, model or sound file: every pixel is synthesised on the GPU from 3D noise.

---

<a id="en"></a>

## English

### What it is

A planet generator that runs at interactive frame rates in any modern browser, on a desktop, a tablet
or a phone. You pick an archetype, type a seed, and move sliders: the world reshapes itself live.

- **Five archetypes** in one tap: Terran Prime, Arrakis Arid, Mustafar Volcanic, Europa Cryo,
  Kepler Super-Earth.
- **Any seed**, a number or a word. The same seed always gives the same planet.
- **Surface**: continents from domain-warped fractal noise, ridged mountains, canyons, dunes, oceans
  with depth gradient and sun glint, biomes by latitude, height and moisture, polar caps, snow lines,
  lava seas, night-side city lights with roads between them.
- **Sky**: an evolving cloud layer with cyclones and self-shadowing, physically based atmospheric
  scattering (Rayleigh + Mie) with a bright limb and sunset tint on the terminator, a ring system
  with gaps and the planet's shadow across it, stars, a galactic band and the sun disc.
- **Post-processing**: HDR pipeline, bloom, ACES filmic tone mapping, dithering.
- **Surface probe**: a click or a tap on the planet drops a marker and opens a card with what is
  there: the kind of terrain (29 kinds, named to suit each world), an estimate of height or depth in
  km and of temperature in °C, humidity, coordinates and how high the sun stands. **Why here** says
  in a line or two what made the place so (the snow line, the dry belt, the waterline), and **What
  if** names the slider that would change it, with a **Try it** button.
- **Guided tours**: five routes in the **Worlds** tab (Sky and sunset, Ring shadows, Ice and
  deserts, Where people live, Kinds of worlds). Each one moves the camera, the sun and the sliders
  step by step, ends with three questions, and offers to bring your own world back. Progress is kept
  in the browser.
- **Links to worlds**: the address always holds the world on screen (archetype, seed, changed sliders,
  camera, marker). **Share** sends it from a phone or copies it on a computer; opening the link brings
  the same view back.
- **Three interface languages**: English, Russian, Uzbek. The choice is remembered; numbers follow
  the language (decimal comma or point).
- **No build step is required to run it**, there are no dependencies to install, and no data is
  collected or sent anywhere: the app is fully static.

### Controls

| Action | Mouse and keyboard | Touch screen |
|---|---|---|
| Rotate the view | Drag | Drag with one finger |
| Zoom | Mouse wheel | Pinch with two fingers |
| Choose an archetype | Buttons, or keys `1`–`5` | **Worlds** tab |
| New random seed | **Randomize Seed**, or key `R` | **Worlds** tab → **Randomize Seed** |
| Hide the interface (cinematic mode) | Key `H`, or the button at the bottom | The eye button |
| Probe a point | Click the planet | Tap the planet (the card opens folded; tap it for details) |
| Share the world | **Share** | The share button at the top |
| Close the open section, then the card | `Esc` | Tap the active tab again; the cross on the card |

Sliders: Sea Level, Mountain Relief, Polar Ice Coverage, Civilization Lights, Cloud Coverage,
Atmosphere Density, Atmosphere Hue Shift, Rings On/Off and Ring Tilt, Sun Orbit Angle,
Auto-Rotation Speed, Render Scale. Camera fly-to views: Orbital Overview, Terminator Close-Up,
Night Side Cities, Ring Plane.

### Layout by device

The interface has three layouts built from the same markup. The browser picks one from the window
size and orientation; nothing needs to be configured.

| Layout | When | How it is arranged |
|---|---|---|
| **Desktop** | Wider than 1100 px and taller than 520 px | Two panels at the sides, language switch at the top, hints and the hide button at the bottom |
| **Compact, portrait** | Up to 1100 px wide (phones, tablets held upright) | Planet name at the top, five tabs at the bottom, settings in a bottom sheet |
| **Compact, landscape** | Landscape up to 1100 px wide, or up to 520 px tall (phones on their side) | Tabs in a rail on the right edge, under the thumb; settings in a drawer beside it |

Tabs: **Worlds** (archetype, seed) · **Surface** · **Sky** (atmosphere, rings) · **View** (camera,
orbit) · **System** (render, language, telemetry).

The planet is always framed inside the area the controls leave free: when a sheet opens or the screen
rotates, the picture glides aside and the field of view adjusts, so the planet stays whole and round.

On touch screens buttons are at least 42 px tall, sliders have enlarged handles, the notch and the
home indicator are respected (safe-area insets), and the text field does not trigger the iOS zoom.

### Quality tiers

The caches that hold the procedural fields are sized to the device.

| Tier | Chosen for | Terrain cube | Clouds | Sky | Max pixel ratio |
|---|---|---|---|---|---|
| `high` | Desktops and laptops; iPhone and iPad on iOS 26 or later; Android devices reporting 8 GB of memory | 1024² | 768² | 512² | 1.5 |
| `medium` | Other tablets and phones | 768² | 512² | 384² | 1.5 |
| `low` | Phones reporting 4 GB of memory or less; any mobile device reporting 2 GB or less | 512² | 384² | 256² | 1.25 |

Add `?quality=high`, `?quality=medium` or `?quality=low` to the address to override the choice.
The active tier is shown in the telemetry (**System** tab on mobile). On top of that, a resolution
governor lowers the render resolution when the GPU cannot keep up, so a slow device loses pixels
rather than frames.

iPhone and iPad report neither their memory nor their model. iOS 26 and later (iPhone 11 / iPad 8th
generation and newer) is recognised by its WebGPU support and the Safari version and gets `high`;
older iOS gets `medium`. Firefox on Android does not report memory either and gets `medium`.

### Run locally

You need [Node.js](https://nodejs.org) 20 or newer. There is nothing to install.

```bash
node tools/serve.mjs
```

Then open `http://localhost:5173`. The server also prints the computer's address on the local
network: open that address on a phone or tablet connected to the same Wi-Fi to try the mobile layout
on a real device. (The system firewall may ask once whether to allow Node.js.)

The same commands through npm: `npm run dev`, `npm run build`, `npm run preview`, `npm run icons`,
`npm run vendor`.

### Build

```bash
node tools/build-single.mjs
```

The build has no dependencies. It folds `index.html`, the stylesheet and all modules into one page
and writes the `dist/` folder:

| File | Purpose |
|---|---|
| `dist/index.html` | The site's entry page; loads Three.js from `vendor/` as separate files the browser keeps cached between releases |
| `dist/planet-generator.html` | The same page with Three.js inside it too: one file that runs opened straight from the disk, with no network at all |
| `dist/vendor/` | Three.js for `index.html` |
| `dist/manifest.webmanifest`, `dist/icons/` | What "Add to Home Screen" needs |

`node tools/serve.mjs 4173 dist` serves the built site exactly as a host would.

### Deploy to Vercel

The repository is ready: [vercel.json](vercel.json) holds the build command, the output folder and
the security headers.

1. Open [vercel.com/new](https://vercel.com/new) and import this GitHub repository.
2. Leave every setting as it is: the framework preset is "Other", the build command and the output
   directory are read from `vercel.json`.
3. Press **Deploy**.

No environment variables are needed. Every push to `main` is deployed automatically; other branches
and pull requests get preview addresses.

Any other static host works the same way: run the build and publish the `dist/` folder.

On a phone, open the deployed address and choose **Add to Home Screen** in the browser menu: the app
then starts full-screen, without the browser's bars.

### Project structure

```
index.html                 HUD markup, import map, entry point
manifest.webmanifest       web app manifest
icons/                     app icons (drawn by tools/make-icons.mjs)
vendor/three-0.170.0/      Three.js r170: the minified core and the add-ons in use (MIT)
css/hud.css                the graphite telemetry overlay and its three layouts
src/main.js                renderer, composer, frame loop, framing, LOD, resolution governor
src/quality.js             quality tiers and device detection
src/uniforms.js            the shared uniform registry
src/state.js               parameters, smoothing, seed → derived uniforms
src/presets.js             the five archetypes
src/i18n.js                EN / RU / UZ dictionaries, number formatting
src/world.js               meshes: planet, clouds, atmosphere, rings, sky
src/bake.js                bakes terrain, cloud and sky cube maps, the ring profile, the atmosphere LUT
src/camera.js              orbit controls and smooth fly-to moves
src/hud.js                 panels, tabs, sliders, telemetry, language switch, hot keys
src/probe.js               reads the terrain caches under the marker on the GPU
src/survey.js              turns a probe reading into terrain kind, words and figures
src/cards.js               the probe card and the toast
src/tours.js               the five tour routes, as data
src/tour.js                runs a tour: steps, questions, progress, the way back
src/link.js                the world in the address: encode, decode, write back
src/shaders/               GLSL: shared chunks, bake passes, planet, probe, clouds, atmosphere, rings, sky
tools/serve.mjs            static dev server
tools/build-single.mjs     single-file build
tools/make-icons.mjs       icon generator
tools/vendor-three.mjs     copies Three.js from the npm registry into vendor/
vercel.json                Vercel configuration
docs/                      plans, ideas and the record of what was verified (in Russian)
```

### How it works

The expensive fields (terrain height, climate, city lights, clouds, the ring profile, the nebula) are
synthesised from 3D noise into cube maps and lookup tables once per world; the per-frame shaders only
read them. A cube map is addressed by the same 3D direction as the noise, so there are no seams and
no pinching at the poles. Sliders are live uniforms and never trigger a re-bake, which is why
dragging them stays smooth. Changing the seed or the archetype re-synthesises the world in a few
frames behind a short exposure fade.

The shaders are compiled before the first frame without blocking the page: where the browser
supports parallel compilation (`KHR_parallel_shader_compile`), the drivers work in the background
while the loading screen stays responsive.

### Requirements and limitations

- A browser with WebGL 2 and rendering to half-float textures: current Chrome, Edge, Firefox, Safari
  (iOS 15 and later).
- Three.js r170 is part of the repository (`vendor/`, MIT licence): the site depends on no CDN, and
  `planet-generator.html` runs without a network. `node tools/vendor-three.mjs <version>` replaces it
  with another version from the npm registry.
- The layouts were verified in a desktop browser emulating phone and tablet sizes. Frame rate on real
  phones and tablets was not measured: the quality tiers and the resolution governor are sized with
  a margin, but only a run on the device shows the real figure.
- Terrain is bump-mapped, not displaced: the silhouette of the planet is a smooth sphere.
- The Uzbek interface text was checked against reference terminology but not proofread by a native
  speaker.

### License

No license has been chosen yet. Until a `LICENSE` file is added, the code is published for viewing
and all rights remain with the author.

---

<a id="uz"></a>

## Oʻzbekcha

### Bu nima

Zamonaviy brauzerda — kompyuterda ham, planshetda ham, telefonda ham — real vaqt rejimida ishlaydigan
sayyoralar generatori. Three.js r170 va qoʻlda yozilgan GLSL sheyderlari asosida qurilgan. Loyihada
birorta ham tayyor tekstura, model yoki tovush fayli yoʻq: har bir piksel grafik protsessorda 3D
shovqindan hosil qilinadi.

Sayyora turini tanlaysiz, generatsiya kalitini kiritasiz, slayderlarni surasiz — olam koʻz oʻngingizda
oʻzgaradi.

- **Besh turdagi sayyora** bir bosishda: Terra Praym, Qurgʻoqchil Arrakis, Vulqonli Mustafar,
  Muzli Yevropa, Kepler super-Yeri.
- **Istalgan generatsiya kaliti** — son yoki soʻz. Bir xil kalit har doim bir xil sayyorani beradi.
- **Sirt**: fraktal shovqindan yaralgan qitʼalar, togʻ tizmalari, kanyonlar, qum tepalari, chuqurligi
  seziladigan va quyosh aksi tushadigan okeanlar, kenglik, balandlik va namlikka bogʻliq tabiat
  zonalari, qutb muzliklari, qor chegarasi, lava dengizlari, tungi tomonda shahar chiroqlari va
  ularni bogʻlovchi yoʻllar.
- **Osmon**: siklonlari bor, oʻz-oʻziga soya tashlaydigan va vaqt oʻtishi bilan oʻzgarib turadigan
  bulut qatlami; fizik asosdagi atmosfera sochilishi (Reley va Mi) — yorqin gardish, terminatorda
  shafaq tusi; oraliqlari bor va sayyora soyasi tushadigan halqalar tizimi; yulduzlar, galaktika
  tasmasi va quyosh diski.
- **Tasvirga ishlov berish**: HDR, blum (yorugʻlik halqasi), ACES ton xaritalash, dizering.
- **Sirt zondi**: sayyorani bosish yoki unga tegish sirtga belgi qoʻyadi va oʻsha nuqta haqida kartochka
  ochadi: joy turi (29 xil, har bir olamga mos nomlar bilan), balandlik yoki chuqurlik (km) va harorat
  (°C) taxmini, namlik, koordinatalar va quyosh balandligi. **Nega bu yerda shunday** joyni nima
  shunday qilganini bir-ikki qatorda aytadi (qor chegarasi, quruq mintaqa, suv chizigʻi), **Nima
  boʻlardi** esa uni oʻzgartiradigan slayderni koʻrsatadi va **Sinab koʻrish** tugmasini beradi.
- **Ekskursiyalar**: **Olamlar** boʻlimida beshta yoʻnalish (Osmon va shafaq, Halqalar soyasi, Muz
  va choʻllar, Odamlar qayerda yashaydi, Dunyolar qanday boʻladi). Har biri kamera, quyosh va
  slayderlarni qadam-baqadam suradi, oxirida uchta savol beradi va oʻz olamingni qaytarishni taklif
  qiladi. Natijalar brauzerda saqlanadi.
- **Olamga havola**: manzil satrida doim ekrandagi olam turadi (sayyora turi, kalit, oʻzgargan slayderlar,
  kamera, belgi). **Ulashish** telefonda havolani yuboradi, kompyuterda nusxalaydi; havolani ochish
  xuddi shu koʻrinishni qaytaradi.
- **Interfeys uch tilda**: inglizcha, ruscha, oʻzbekcha. Tanlov eslab qolinadi; sonlar tilga mos
  yoziladi (oʻnli vergul yoki nuqta).
- **Ishga tushirish uchun yigʻish shart emas**, oʻrnatiladigan kutubxonalar yoʻq, hech qanday
  maʼlumot yigʻilmaydi va hech qayerga yuborilmaydi: ilova toʻliq statik.

### Boshqaruv

| Amal | Sichqoncha va klaviatura | Sensorli ekran |
|---|---|---|
| Koʻrinishni aylantirish | Sichqonchani bosib tortish | Bir barmoq bilan tortish |
| Yaqinlashtirish va uzoqlashtirish | Sichqoncha gʻildiragi | Ikki barmoq bilan |
| Sayyora turini tanlash | Tugmalar yoki `1`–`5` klavishlari | **Olamlar** boʻlimi |
| Yangi tasodifiy kalit | **Tasodifiy kalit** tugmasi yoki `R` | **Olamlar** boʻlimi → **Tasodifiy kalit** |
| Interfeysni yashirish (kino rejimi) | `H` klavishi yoki pastdagi tugma | Koʻz belgili tugma |
| Nuqtani zond bilan oʻrganish | Sayyorani bosish | Sayyoraga tegish (kartochka yigʻilgan holda ochiladi; tafsilotlar uchun unga tegish) |
| Olamni ulashish | **Ulashish** | Yuqoridagi ulashish tugmasi |
| Ochiq boʻlimni, soʻng kartochkani yopish | `Esc` | Faol boʻlim tugmasini yana bir marta bosish; kartochkadagi xoch |

Slayderlar: dengiz sathi, togʻ relyefi, qutb muzliklari, sivilizatsiya chiroqlari, bulutlilik,
atmosfera zichligi, atmosfera tusi, halqalar (bor yoki yoʻq) va ularning ogʻishi, quyosh burchagi,
aylanish tezligi, render masshtabi. Kamera koʻrinishlari: orbital umumiy koʻrinish, terminator
yaqindan, tungi shaharlar, halqalar tekisligi — kamera ularga ravon uchib boradi.

### Qurilmaga qarab joylashuv

Interfeys bitta belgilashdan qurilgan uch xil joylashuvga ega. Brauzer ulardan birini oyna oʻlchami va
ekran holatiga qarab oʻzi tanlaydi — hech narsani sozlash kerak emas.

| Joylashuv | Qachon | Qanday tuzilgan |
|---|---|---|
| **Kompyuter** | Eni 1100 px dan, boʻyi 520 px dan katta | Ikki chetda ikkita panel, tepada til tanlash, pastda maslahatlar va yashirish tugmasi |
| **Ixcham, tik holat** | Eni 1100 px gacha (telefon, tik ushlangan planshet) | Tepada sayyora nomi, pastda beshta boʻlim, sozlamalar pastdan chiqadigan panelda |
| **Ixcham, yotiq holat** | Yotiq holatda eni 1100 px gacha yoki boʻyi 520 px gacha (yonboshlatilgan telefon) | Boʻlimlar oʻng chetda, bosh barmoq ostida; sozlamalar uning yonidagi panelda |

Boʻlimlar: **Olamlar** (sayyora turi, kalit) · **Sirt** · **Osmon** (atmosfera, halqalar) ·
**Koʻrinish** (kamera, orbita) · **Tizim** (render, til, telemetriya).

Sayyora har doim boshqaruv elementlaridan boʻsh qolgan maydonda turadi: panel ochilganda yoki ekran
burilganda tasvir ravon suriladi va koʻrish burchagi moslashadi — sayyora butun va dumaloq qoladi.

Sensorli ekranlarda tugmalar balandligi kamida 42 px, slayder tutqichlari kattalashtirilgan, ekran
oʻyigʻi va pastki chiziq hisobga olingan (xavfsiz maydonlar), matn maydoni esa iOS da sahifani
kattalashtirib yubormaydi.

### Sifat darajalari

Protsedurali maydonlar saqlanadigan keshlar hajmi qurilmaga qarab tanlanadi.

| Daraja | Kimlar uchun | Relyef kubi | Bulutlar | Osmon | Eng katta piksel nisbati |
|---|---|---|---|---|---|
| `high` | Kompyuter va noutbuklar; iOS 26 va undan yangi tizimdagi iPhone va iPad; xotirasi 8 GB deb xabar bergan Android qurilmalar | 1024² | 768² | 512² | 1,5 |
| `medium` | Boshqa planshet va telefonlar | 768² | 512² | 384² | 1,5 |
| `low` | Xotirasi 4 GB va undan kam deb xabar bergan telefonlar; 2 GB va undan kam har qanday mobil qurilma | 512² | 384² | 256² | 1,25 |

Tanlovni oʻzgartirish uchun manzil oxiriga `?quality=high`, `?quality=medium` yoki `?quality=low`
qoʻshing. Amaldagi daraja telemetriyada koʻrsatiladi (mobil qurilmada — **Tizim** boʻlimida). Bundan
tashqari, grafik protsessor ulgurmay qolsa, aniqlik boshqaruvchisi render aniqligini pasaytiradi:
sust qurilma kadrlarni emas, piksellarni yoʻqotadi.

iPhone va iPad xotira hajmini ham, modelini ham xabar qilmaydi. iOS 26 va undan yangisi (iPhone 11 /
iPad 8-avlod va undan yangilari) WebGPU qoʻllanishi va Safari versiyasidan aniqlanadi va `high`
darajasini oladi; eskiroq iOS — `medium`. Android dagi Firefox ham xotirani xabar qilmaydi va
`medium` oladi.

### Kompyuterda ishga tushirish

[Node.js](https://nodejs.org) 20 yoki undan yangi versiyasi kerak. Hech narsa oʻrnatish shart emas.

```bash
node tools/serve.mjs
```

Soʻng `http://localhost:5173` manzilini oching. Server kompyuterning mahalliy tarmoqdagi manzilini
ham chiqaradi: mobil joylashuvni haqiqiy qurilmada sinash uchun shu manzilni oʻsha Wi-Fi ga ulangan
telefon yoki planshetda oching. (Tizim xavfsizlik devori Node.js ga ruxsat berishni bir marta
soʻrashi mumkin.)

Xuddi shu buyruqlar npm orqali: `npm run dev`, `npm run build`, `npm run preview`, `npm run icons`,
`npm run vendor`.

### Yigʻish

```bash
node tools/build-single.mjs
```

Yigʻuvchi tashqi kutubxonalarsiz ishlaydi. U `index.html`, uslublar fayli va barcha modullarni bitta
sahifaga jamlab, `dist/` papkasini yozadi:

| Fayl | Vazifasi |
|---|---|
| `dist/index.html` | Saytning kirish sahifasi; Three.js ni `vendor/` dan alohida fayllar sifatida yuklaydi, brauzer ularni relizlar orasida keshda saqlaydi |
| `dist/planet-generator.html` | Oʻsha sahifa, Three.js ham ichida: diskdan toʻgʻridan-toʻgʻri, tarmoqsiz ochiladigan bitta fayl |
| `dist/vendor/` | `index.html` uchun Three.js |
| `dist/manifest.webmanifest`, `dist/icons/` | «Bosh ekranga qoʻshish» uchun kerakli fayllar |

`node tools/serve.mjs 4173 dist` buyrugʻi yigʻilgan saytni xosting qanday tarqatsa, shunday tarqatadi.

### Vercel ga joylashtirish

Repozitoriy tayyor: [vercel.json](vercel.json) faylida yigʻish buyrugʻi, natija papkasi va xavfsizlik
sarlavhalari yozilgan.

1. [vercel.com/new](https://vercel.com/new) sahifasini oching va shu GitHub repozitoriysini import
   qiling.
2. Sozlamalarga tegmang: freymvork — «Other», yigʻish buyrugʻi va natija papkasi `vercel.json` dan
   olinadi.
3. **Deploy** tugmasini bosing.

Muhit oʻzgaruvchilari kerak emas. `main` tarmogʻiga yuborilgan har bir oʻzgarish avtomatik
joylashtiriladi; boshqa tarmoqlar va pull-requestlar uchun sinov manzillari beriladi.

Boshqa har qanday statik xosting ham xuddi shunday ishlaydi: yigʻishni bajaring va `dist/` papkasini
joylashtiring.

Telefonda joylashtirilgan manzilni oching va brauzer menyusidan **Bosh ekranga qoʻshish** ni tanlang:
shundan soʻng ilova brauzer panellarisiz, toʻliq ekranda ochiladi.

### Loyiha tuzilishi

```
index.html                 HUD belgilashi, import map, kirish nuqtasi
manifest.webmanifest       veb-ilova manifesti
icons/                     ilova belgilari (tools/make-icons.mjs chizadi)
vendor/three-0.170.0/      Three.js r170: siqilgan yadro va ishlatiladigan qoʻshimchalar (MIT)
css/hud.css                grafit rangli telemetriya qatlami va uning uch joylashuvi
src/main.js                renderer, kompozer, kadr sikli, kadrlash, LOD, aniqlik boshqaruvchisi
src/quality.js             sifat darajalari va qurilmani aniqlash
src/uniforms.js            umumiy uniformlar roʻyxati
src/state.js               parametrlar, silliqlash, kalit → hosila uniformlar
src/presets.js             besh turdagi sayyora
src/i18n.js                EN / RU / UZ lugʻatlari, sonlar formati
src/world.js               meshlar: sayyora, bulutlar, atmosfera, halqalar, osmon
src/bake.js                relyef, bulut va osmon kub xaritalarini, halqa profilini, atmosfera jadvalini hisoblaydi
src/camera.js              orbital boshqaruv va ravon uchib borish
src/hud.js                 panellar, boʻlimlar, slayderlar, telemetriya, til tanlash, tezkor klavishlar
src/probe.js               belgi ostidagi relyef keshlarini GPU da oʻqiydi
src/survey.js              zond oʻlchovini joy turi, soʻzlar va raqamlarga aylantiradi
src/cards.js               zond kartochkasi va qisqa xabar
src/tours.js               beshta ekskursiya yoʻnalishi, maʼlumot sifatida
src/tour.js                ekskursiyani olib boradi: qadamlar, savollar, natija, olamni qaytarish
src/link.js                manzildagi olam: yozish, oʻqish, yangilash
src/shaders/               GLSL: umumiy bloklar, kesh hisoblash, sayyora, zond, bulutlar, atmosfera, halqalar, osmon
tools/serve.mjs            statik ishlab chiqish serveri
tools/build-single.mjs     bitta faylga yigʻish
tools/make-icons.mjs       belgilar generatori
tools/vendor-three.mjs     Three.js ni npm reyestridan vendor/ ga koʻchiradi
vercel.json                Vercel sozlamalari
docs/                      rejalar, gʻoyalar va nimalar tekshirilgani haqidagi qaydlar (rus tilida)
```

### Qanday ishlaydi

Qimmat maydonlar (relyef balandligi, iqlim, shahar chiroqlari, bulutlar, halqa profili, tumanlik) har
bir olam uchun bir marta 3D shovqindan kub xaritalar va jadvallarga hisoblab qoʻyiladi; har kadrda
ishlaydigan sheyderlar ularni faqat oʻqiydi. Kub xarita shovqin bilan bir xil 3D yoʻnalish boʻyicha
oʻqiladi, shuning uchun choklar ham, qutblardagi siqilish ham yoʻq. Slayderlar — jonli uniformlar,
ular keshni qayta hisoblatmaydi, shu sababli surilganda tasvir ravon qoladi. Kalit yoki sayyora turi
oʻzgarganda olam bir necha kadr ichida, ekran qisqa muddatga xiralashgan paytda qayta yaratiladi.

Sheyderlar birinchi kadrdan oldin, sahifani toʻxtatmasdan kompilyatsiya qilinadi: brauzer parallel
kompilyatsiyani (`KHR_parallel_shader_compile`) qoʻllasa, drayverlar fonda ishlaydi, yuklanish
ekrani esa javob berishda davom etadi.

### Talablar va cheklovlar

- WebGL 2 va half-float teksturalarga renderlashni qoʻllaydigan brauzer: Chrome, Edge, Firefox,
  Safari ning hozirgi versiyalari (iOS 15 va undan yangi).
- Three.js r170 repozitoriyning bir qismi (`vendor/`, MIT litsenziyasi): sayt hech qanday CDN ga
  bogʻliq emas, `planet-generator.html` esa tarmoqsiz ishlaydi. `node tools/vendor-three.mjs <versiya>`
  uni npm reyestridagi boshqa versiyaga almashtiradi.
- Joylashuvlar kompyuter brauzerida, telefon va planshet oʻlchamlarini taqlid qilib tekshirilgan.
  Haqiqiy telefon va planshetlarda kadrlar chastotasi oʻlchanmagan: sifat darajalari va aniqlik
  boshqaruvchisi zaxira bilan tanlangan, ammo haqiqiy natijani faqat qurilmaning oʻzida ishga
  tushirish koʻrsatadi.
- Relyef — bump (yorugʻlik orqali boʻrttirish), geometriya emas: sayyora chegarasi silliq sfera.
- Oʻzbekcha interfeys matni atamalar boʻyicha solishtirilgan, lekin til sohibi tomonidan
  tahrir qilinmagan.

### Litsenziya

Litsenziya hali tanlanmagan. `LICENSE` fayli qoʻshilmaguncha kod tanishish uchun eʼlon qilingan,
barcha huquqlar muallifda qoladi.

---

<a id="ru"></a>

## Русский

### Что это

Генератор планет, который работает в реальном времени в любом современном браузере — на компьютере,
планшете и телефоне. Three.js r170 и собственные GLSL-шейдеры. В проекте нет ни одной готовой
текстуры, модели или звукового файла: каждый пиксель синтезируется на видеокарте из 3D-шума.

Выбираете архетип, вводите ключ генерации, двигаете слайдеры — мир перестраивается на глазах.

- **Пять архетипов** в одно касание: Терра Прайм, Засушливый Арракис, Огненный Мустафар,
  Ледяная Европа, Суперземля Кеплер.
- **Любой ключ генерации** — число или слово. Один и тот же ключ всегда даёт одну и ту же планету.
- **Поверхность**: континенты из фрактального шума с доменным искажением, горные хребты, каньоны,
  дюны, океаны с градиентом глубины и солнечным бликом, биомы по широте, высоте и влажности,
  полярные шапки, линия снега, лавовые моря, огни городов на ночной стороне и дороги между ними.
- **Небо**: меняющийся во времени облачный слой с циклонами и самозатенением; физически обоснованное
  рассеяние в атмосфере (Рэлей и Ми) с ярким лимбом и закатным оттенком на терминаторе; система колец
  со щелями и тенью планеты на них; звёзды, галактическая полоса и диск солнца.
- **Пост-обработка**: HDR, блум, тональная компрессия ACES, дизеринг.
- **Зонд**: щелчок или касание по планете ставит метку и открывает карточку с тем, что там: тип
  местности (29 типов, названия под каждый мир), оценка высоты или глубины в км и температуры в °C,
  влажность, координаты и высота солнца. **Почему здесь так** в одной-двух строках объясняет, что
  сделало место таким (снеговая линия, сухой пояс, урез воды), а **А что если** называет слайдер,
  который это изменит, с кнопкой **Попробовать**.
- **Экскурсии**: пять маршрутов во вкладке **Миры** (Небо и закат, Тени колец, Лёд и пустыни, Где
  живут люди, Какими бывают миры). Каждый шаг за шагом ведёт камеру, солнце и слайдеры, в конце
  задаёт три вопроса и предлагает вернуть твой мир. Прогресс хранится в браузере.
- **Ссылки на миры**: в адресе страницы всегда записан мир на экране (архетип, ключ, изменённые
  слайдеры, камера, метка). **Поделиться** отправляет ссылку с телефона или копирует её на компьютере;
  по ссылке открывается тот же вид.
- **Три языка интерфейса**: английский, русский, узбекский. Выбор запоминается; числа пишутся по
  правилам языка (десятичная запятая или точка).
- **Для запуска не нужна сборка**, нет устанавливаемых зависимостей, никакие данные не собираются и
  никуда не отправляются: приложение полностью статическое.

### Управление

| Действие | Мышь и клавиатура | Сенсорный экран |
|---|---|---|
| Вращать вид | Тянуть мышью | Тянуть одним пальцем |
| Приблизить или отдалить | Колесо мыши | Свести или развести два пальца |
| Выбрать архетип | Кнопки или клавиши `1`–`5` | Вкладка **Миры** |
| Новый случайный ключ | Кнопка **Случайный ключ** или клавиша `R` | Вкладка **Миры** → **Случайный ключ** |
| Скрыть интерфейс (кинорежим) | Клавиша `H` или кнопка внизу | Кнопка с глазом |
| Узнать данные точки | Щелчок по планете | Касание планеты (карточка открывается свёрнутой; касание по ней — подробности) |
| Поделиться миром | **Поделиться** | Кнопка «поделиться» вверху |
| Закрыть открытый раздел, затем карточку | `Esc` | Ещё раз нажать на активную вкладку; крестик на карточке |

Клавиши `H` и `R` работают и при русской раскладке.

Слайдеры: уровень моря, горный рельеф, полярный лёд, огни цивилизации, облачность, плотность
атмосферы, оттенок атмосферы, кольца (есть или нет) и их наклон, угол солнца, скорость вращения,
масштаб рендера. Ракурсы камеры: орбитальный обзор, терминатор вблизи, ночные города, плоскость
колец — камера плавно перелетает к каждому.

### Раскладка под устройство

У интерфейса три раскладки, собранные из одной и той же разметки. Браузер сам выбирает нужную по
размеру окна и ориентации — настраивать ничего не нужно.

| Раскладка | Когда | Как устроена |
|---|---|---|
| **Десктоп** | Шире 1100 px и выше 520 px | Две панели по краям, выбор языка сверху, подсказки и кнопка скрытия снизу |
| **Компактная, портрет** | Ширина до 1100 px (телефоны, планшеты вертикально) | Сверху — название планеты, снизу — пять вкладок, параметры — в выезжающем снизу листе |
| **Компактная, альбом** | Альбомная ориентация при ширине до 1100 px или высоте до 520 px (телефон горизонтально) | Вкладки — лентой у правого края, под большим пальцем; параметры — в боковом листе рядом с ней |

Вкладки: **Миры** (архетип, ключ) · **Поверхность** · **Небо** (атмосфера, кольца) · **Вид** (камера,
орбита) · **Система** (рендер, язык, телеметрия).

Планета всегда стоит в области, свободной от элементов управления: когда открывается лист или
поворачивается экран, картинка плавно сдвигается, а поле зрения подстраивается — планета остаётся
целой и круглой.

На сенсорных экранах кнопки не ниже 42 px, у слайдеров увеличенные бегунки, учтены вырез экрана и
нижняя полоса жестов (безопасные зоны), а поле ввода не вызывает автоматическое увеличение в iOS.

### Профили качества

Размер кэшей, в которых хранятся процедурные поля, подбирается под устройство.

| Профиль | Для кого | Куб рельефа | Облака | Небо | Макс. плотность пикселей |
|---|---|---|---|---|---|
| `high` | Компьютеры и ноутбуки; iPhone и iPad на iOS 26 и новее; Android-устройства, сообщающие о 8 ГБ памяти | 1024² | 768² | 512² | 1,5 |
| `medium` | Остальные планшеты и телефоны | 768² | 512² | 384² | 1,5 |
| `low` | Телефоны, сообщающие о 4 ГБ памяти и меньше; любые мобильные устройства с 2 ГБ и меньше | 512² | 384² | 256² | 1,25 |

Чтобы выбрать профиль вручную, добавьте к адресу `?quality=high`, `?quality=medium` или
`?quality=low`. Действующий профиль показан в телеметрии (на мобильных — вкладка **Система**).
Сверх этого работает регулятор разрешения: если видеокарта не успевает, он снижает разрешение
рендера, так что слабое устройство теряет пиксели, а не кадры.

iPhone и iPad не сообщают ни объём памяти, ни модель. iOS 26 и новее (iPhone 11 / iPad 8-го поколения
и новее) распознаётся по поддержке WebGPU и версии Safari и получает `high`; более старая iOS —
`medium`. Firefox на Android тоже не сообщает память и получает `medium`.

### Запуск на компьютере

Нужен [Node.js](https://nodejs.org) версии 20 или новее. Устанавливать ничего не требуется.

```bash
node tools/serve.mjs
```

Затем откройте `http://localhost:5173`. Сервер печатает и адрес компьютера в локальной сети: откройте
его на телефоне или планшете, подключённом к тому же Wi-Fi, чтобы попробовать мобильную раскладку на
настоящем устройстве. (Системный брандмауэр может один раз спросить разрешение для Node.js.)

Те же команды через npm: `npm run dev`, `npm run build`, `npm run preview`, `npm run icons`,
`npm run vendor`.

### Сборка

```bash
node tools/build-single.mjs
```

Сборщик работает без зависимостей. Он сворачивает `index.html`, стили и все модули в одну страницу и
записывает папку `dist/`:

| Файл | Назначение |
|---|---|
| `dist/index.html` | Входная страница сайта; загружает Three.js из `vendor/` отдельными файлами, которые браузер хранит в кэше между релизами |
| `dist/planet-generator.html` | Та же страница, и Three.js тоже внутри: один файл, который открывается прямо с диска, без сети |
| `dist/vendor/` | Three.js для `index.html` |
| `dist/manifest.webmanifest`, `dist/icons/` | Всё, что нужно для «Добавить на экран „Домой“» |

Команда `node tools/serve.mjs 4173 dist` раздаёт собранный сайт так же, как это сделает хостинг.

### Деплой на Vercel

Репозиторий готов: в [vercel.json](vercel.json) записаны команда сборки, папка с результатом и
заголовки безопасности.

1. Откройте [vercel.com/new](https://vercel.com/new) и импортируйте этот репозиторий GitHub.
2. Ничего не меняйте в настройках: пресет фреймворка — «Other», команда сборки и папка результата
   берутся из `vercel.json`.
3. Нажмите **Deploy**.

Переменные окружения не нужны. Каждая отправка в ветку `main` разворачивается автоматически; другие
ветки и pull request'ы получают адреса для предпросмотра.

Любой другой статический хостинг работает так же: выполните сборку и опубликуйте папку `dist/`.

На телефоне откройте адрес сайта и выберите в меню браузера **Добавить на экран «Домой»**: после
этого приложение запускается на весь экран, без панелей браузера.

### Структура проекта

```
index.html                 разметка HUD, import map, точка входа
manifest.webmanifest       манифест веб-приложения
icons/                     иконки приложения (рисует tools/make-icons.mjs)
vendor/three-0.170.0/      Three.js r170: минифицированное ядро и используемые аддоны (MIT)
css/hud.css                графитовый телеметрический оверлей и три его раскладки
src/main.js                рендерер, композер, цикл кадра, кадрирование, LOD, регулятор разрешения
src/quality.js             профили качества и определение устройства
src/uniforms.js            общий реестр uniform-ов
src/state.js               параметры, сглаживание, ключ → производные uniform-ы
src/presets.js             пять архетипов
src/i18n.js                словари EN / RU / UZ, формат чисел
src/world.js               меши: планета, облака, атмосфера, кольца, небо
src/bake.js                запекание кубических карт рельефа, облаков и неба, профиля колец, таблицы атмосферы
src/camera.js              орбитальное управление и плавные перелёты
src/hud.js                 панели, вкладки, слайдеры, телеметрия, выбор языка, горячие клавиши
src/probe.js               читает кэши рельефа под меткой на GPU
src/survey.js              превращает показания зонда в тип местности, слова и числа
src/cards.js               карточка зонда и всплывающее уведомление
src/tours.js               пять маршрутов экскурсий в виде данных
src/tour.js                ведёт экскурсию: шаги, вопросы, прогресс, возврат мира
src/link.js                мир в адресе страницы: запись, чтение, обновление
src/shaders/               GLSL: общие блоки, запекание, планета, зонд, облака, атмосфера, кольца, небо
tools/serve.mjs            статический сервер для разработки
tools/build-single.mjs     сборка в один файл
tools/make-icons.mjs       генератор иконок
tools/vendor-three.mjs     копирует Three.js из реестра npm в vendor/
vercel.json                настройки Vercel
docs/                      планы, идеи и перечень того, что проверено
```

### Как это работает

Дорогие поля (высота рельефа, климат, огни городов, облака, профиль колец, туманность) синтезируются
из 3D-шума в кубические карты и таблицы один раз на мир; покадровые шейдеры их только читают.
Кубическая карта адресуется тем же 3D-направлением, что и шум, поэтому нет ни швов, ни стягивания к
полюсам. Слайдеры — живые uniform-ы и пересчёт кэша не запускают, поэтому при перетаскивании картинка
остаётся плавной. При смене ключа или архетипа мир пересинтезируется за несколько кадров под
коротким затемнением.

Шейдеры компилируются до первого кадра, не блокируя страницу: если браузер поддерживает
параллельную компиляцию (`KHR_parallel_shader_compile`), драйверы работают в фоне, а экран загрузки
остаётся отзывчивым.

### Требования и ограничения

- Браузер с WebGL 2 и рендером в half-float-текстуры: актуальные Chrome, Edge, Firefox, Safari
  (iOS 15 и новее).
- Three.js r170 лежит в репозитории (`vendor/`, лицензия MIT): сайт не зависит ни от какого CDN, а
  `planet-generator.html` работает без сети. `node tools/vendor-three.mjs <версия>` заменяет его
  другой версией из реестра npm.
- Раскладки проверены в десктопном браузере с эмуляцией размеров телефона и планшета. Частота кадров
  на настоящих телефонах и планшетах не измерялась: профили качества и регулятор разрешения выбраны
  с запасом, но реальную цифру покажет только запуск на устройстве.
- Рельеф — bump, а не геометрия: силуэт планеты остаётся гладкой сферой.
- Узбекский текст интерфейса сверен по терминологии, но носителем языка не вычитан.

### Лицензия

Лицензия пока не выбрана. Пока в репозитории нет файла `LICENSE`, код опубликован для ознакомления, а
все права остаются за автором.
