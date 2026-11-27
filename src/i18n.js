// Interface languages. Every piece of text the user can see lives here, keyed
// by a dotted name; the HUD and the entry point only ever ask for keys.
//
// Uzbek is written in the Latin alphabet with the proper letters oʻ / gʻ
// (U+02BB) and the tutuq belgisi ʼ (U+02BC).

export const LANGUAGES = [
  { id: 'en', code: 'EN', name: 'English' },
  { id: 'ru', code: 'RU', name: 'Русский' },
  { id: 'uz', code: 'UZ', name: 'Oʻzbekcha' },
];

const LANGUAGE_STORAGE_KEY = 'planet-generator.language';

const STRINGS = {
  // ------------------------------------------------------------------ English
  en: {
    'app.title': 'Planet Generator 3D — Procedural Planetary Survey',
    'format.decimal': '.',

    'aria.viewport': 'Procedural planet viewport',
    'aria.identity': 'Planet identity and views',
    'aria.parameters': 'Planet parameters',
    'aria.rings': 'Planetary rings',
    'aria.language': 'Interface language',

    'kicker.survey': 'Planetary Survey',
    'kicker.boot': 'Boot',
    'ident.custom': 'Custom',

    'group.archetype': 'Archetype',
    'group.camera': 'Camera',
    'group.cameraHint': 'Fly-to',
    'group.telemetry': 'Telemetry',
    'status.live': 'Live',
    'status.busy': 'Synthesising',

    'camera.overview': 'Orbital Overview',
    'camera.terminator': 'Terminator Close-Up',
    'camera.night': 'Night Side Cities',
    'camera.ring': 'Ring Plane',

    'telemetry.fps': 'Frame Rate',
    'telemetry.ms': 'Frame Time',
    'telemetry.gpu': 'GPU Time',
    'telemetry.res': 'Resolution',
    'telemetry.alt': 'Altitude',
    'telemetry.phase': 'Phase Angle',
    'telemetry.lod': 'Terrain LOD',
    'unit.fps': 'fps',
    'unit.ms': 'ms',
    'unit.radius': 'R',
    'value.lod': 'Cache +{n} oct',

    'section.seed': 'Seed',
    'section.surface': 'Surface',
    'section.surfaceHint': 'Geology',
    'section.atmosphere': 'Atmosphere',
    'section.atmosphereHint': 'Scattering',
    'section.rings': 'Rings',
    'section.ringsHint': 'System',
    'section.orbit': 'Orbit',
    'section.orbitHint': 'Star · Spin',
    'section.render': 'Render',
    'section.renderHint': 'Performance',

    'param.seaLevel': 'Sea Level',
    'param.relief': 'Mountain Relief',
    'param.ice': 'Polar Ice Coverage',
    'param.cityLights': 'Civilization Lights',
    'param.cloudCover': 'Cloud Coverage',
    'param.atmoDensity': 'Atmosphere Density',
    'param.atmoHue': 'Atmosphere Hue Shift',
    'param.ringTilt': 'Ring Tilt',
    'param.sunAngle': 'Sun Orbit Angle',
    'param.rotSpeed': 'Auto-Rotation Speed',
    'param.renderScale': 'Render Scale',

    'seed.randomize': 'Randomize Seed',
    'rings.off': 'Rings Off',
    'rings.on': 'Rings On',

    'hint.dragKey': 'Drag',
    'hint.drag': 'orbit',
    'hint.scrollKey': 'Scroll',
    'hint.scroll': 'zoom',
    'hint.reseed': 'reseed',
    'hint.cinematic': 'cinematic',
    'toggle.hide': 'Hide HUD',
    'toggle.show': 'Show HUD',
    'toggle.title': 'Toggle interface (H)',

    'boot.compiling': 'Compiling shaders…',
    'boot.shaderFailed': 'Shader compilation failed.',
    'boot.startFailed': 'Could not start the renderer.',
    'boot.webgl2': 'WebGL 2 is required.',

    'preset.terran.name': 'Terran Prime',
    'preset.terran.tag': 'Class M',
    'preset.terran.blurb': 'Temperate ocean world. Nitrogen–oxygen air, active water cycle, inhabited coasts.',
    'preset.arrakis.name': 'Arrakis Arid',
    'preset.arrakis.tag': 'Class H',
    'preset.arrakis.blurb': 'Dune world. Deep canyon systems, planet-wide ochre dust storms, no surface water.',
    'preset.mustafar.name': 'Mustafar Volcanic',
    'preset.mustafar.tag': 'Class Y',
    'preset.mustafar.blurb': 'Tidally heated basalt crust. Molten seas, incandescent rivers, sulphurous ash decks.',
    'preset.europa.name': 'Europa Cryo',
    'preset.europa.tag': 'Class P',
    'preset.europa.blurb': 'Fractured ice shell over a buried ocean. Tenuous exosphere, bright Saturnian rings.',
    'preset.kepler.name': 'Kepler Super-Earth',
    'preset.kepler.tag': 'Class K',
    'preset.kepler.blurb': 'High-gravity garden world. Violet and emerald flora, deep swirling air, wide ring plane.',
  },

  // ------------------------------------------------------------------ Русский
  ru: {
    'app.title': 'Planet Generator 3D — процедурные планеты в реальном времени',
    'format.decimal': ',',

    'aria.viewport': 'Область просмотра планеты',
    'aria.identity': 'Сведения о планете и ракурсы',
    'aria.parameters': 'Параметры планеты',
    'aria.rings': 'Кольца планеты',
    'aria.language': 'Язык интерфейса',

    // «Обзор» — принятый в астрономии перевод слова survey (обзор неба).
    'kicker.survey': 'Обзор планет',
    'kicker.boot': 'Запуск',
    'ident.custom': 'Изменён',

    'group.archetype': 'Архетип',
    'group.camera': 'Камера',
    'group.cameraHint': 'Перелёт',
    'group.telemetry': 'Телеметрия',
    'status.live': 'Активна',
    'status.busy': 'Синтез мира',

    'camera.overview': 'Вид с орбиты',
    'camera.terminator': 'Терминатор вблизи',
    'camera.night': 'Ночные города',
    'camera.ring': 'Плоскость колец',

    'telemetry.fps': 'Частота кадров',
    'telemetry.ms': 'Время кадра',
    'telemetry.gpu': 'Время GPU',
    'telemetry.res': 'Разрешение',
    'telemetry.alt': 'Высота',
    'telemetry.phase': 'Фазовый угол',
    'telemetry.lod': 'Детализация рельефа',
    'unit.fps': 'к/с',
    'unit.ms': 'мс',
    'unit.radius': 'R',
    'value.lod': 'Кэш +{n} окт',

    'section.seed': 'Ключ генерации',
    'section.surface': 'Поверхность',
    'section.surfaceHint': 'Геология',
    'section.atmosphere': 'Атмосфера',
    'section.atmosphereHint': 'Рассеяние',
    'section.rings': 'Кольца',
    'section.ringsHint': 'Система',
    'section.orbit': 'Орбита',
    'section.orbitHint': 'Звезда · Вращение',
    'section.render': 'Рендер',
    'section.renderHint': 'Производительность',

    'param.seaLevel': 'Уровень моря',
    'param.relief': 'Горный рельеф',
    'param.ice': 'Полярный ледяной покров',
    'param.cityLights': 'Огни цивилизации',
    'param.cloudCover': 'Облачность',
    'param.atmoDensity': 'Плотность атмосферы',
    'param.atmoHue': 'Сдвиг оттенка атмосферы',
    'param.ringTilt': 'Наклон колец',
    'param.sunAngle': 'Положение солнца на орбите',
    'param.rotSpeed': 'Скорость вращения планеты',
    'param.renderScale': 'Масштаб рендера',

    'seed.randomize': 'Случайный ключ',
    'rings.off': 'Без колец',
    'rings.on': 'С кольцами',

    'hint.dragKey': 'Мышь',
    'hint.drag': 'вращение',
    'hint.scrollKey': 'Колесо',
    'hint.scroll': 'приближение',
    'hint.reseed': 'новый ключ',
    'hint.cinematic': 'кинорежим',
    'toggle.hide': 'Скрыть интерфейс',
    'toggle.show': 'Показать интерфейс',
    'toggle.title': 'Скрыть или показать интерфейс (H)',

    'boot.compiling': 'Компиляция шейдеров…',
    'boot.shaderFailed': 'Не удалось скомпилировать шейдеры.',
    'boot.startFailed': 'Не удалось запустить рендерер.',
    'boot.webgl2': 'Требуется WebGL 2.',

    'preset.terran.name': 'Терра Прайм',
    'preset.terran.tag': 'Класс M',
    'preset.terran.blurb': 'Умеренный океанический мир. Азотно-кислородная атмосфера, активный круговорот воды, обжитые побережья.',
    'preset.arrakis.name': 'Засушливый Арракис',
    'preset.arrakis.tag': 'Класс H',
    'preset.arrakis.blurb': 'Мир дюн. Глубокие системы каньонов, глобальные пылевые бури цвета охры, открытой воды нет.',
    // (Не «Вулканический»: 22 знака не помещаются в строку кнопки на всех шрифтах.)
    'preset.mustafar.name': 'Огненный Мустафар',
    'preset.mustafar.tag': 'Класс Y',
    'preset.mustafar.blurb': 'Базальтовая кора, разогретая приливными силами. Моря расплава, раскалённые реки, сернистые пепельные облака.',
    'preset.europa.name': 'Ледяная Европа',
    'preset.europa.tag': 'Класс P',
    'preset.europa.blurb': 'Растрескавшийся ледяной панцирь над подлёдным океаном. Разрежённая экзосфера, яркие кольца, как у Сатурна.',
    'preset.kepler.name': 'Суперземля Кеплер',
    'preset.kepler.tag': 'Класс K',
    'preset.kepler.blurb': 'Мир-сад с высокой гравитацией. Фиолетовая и изумрудная растительность, мощная вихревая атмосфера, широкая система колец.',
  },

  // ---------------------------------------------------------------- Oʻzbekcha
  uz: {
    'app.title': 'Planet Generator 3D — real vaqtda yaratiladigan protsedurali sayyoralar',
    'format.decimal': ',',

    'aria.viewport': 'Sayyora koʻrinishi maydoni',
    'aria.identity': 'Sayyora haqida maʼlumot va koʻrinishlar',
    'aria.parameters': 'Sayyora parametrlari',
    'aria.rings': 'Sayyora halqalari',
    'aria.language': 'Interfeys tili',

    'kicker.survey': 'Sayyora tadqiqi',
    'kicker.boot': 'Ishga tushirish',
    'ident.custom': 'Maxsus',

    'group.archetype': 'Sayyora turi',
    'group.camera': 'Kamera',
    'group.cameraHint': 'Uchib borish',
    'group.telemetry': 'Telemetriya',
    'status.live': 'Faol',
    'status.busy': 'Sintezlanmoqda',

    'camera.overview': 'Orbitadan koʻrinish',
    'camera.terminator': 'Terminator yaqindan',
    'camera.night': 'Tungi shaharlar',
    'camera.ring': 'Halqalar tekisligi',

    'telemetry.fps': 'Kadrlar chastotasi',
    'telemetry.ms': 'Kadr vaqti',
    'telemetry.gpu': 'GPU vaqti',
    'telemetry.res': 'Tasvir aniqligi',
    'telemetry.alt': 'Balandlik',
    'telemetry.phase': 'Faza burchagi',
    'telemetry.lod': 'Relyef tafsilotlari',
    'unit.fps': 'kadr/s',
    'unit.ms': 'ms',
    'unit.radius': 'R',
    'value.lod': 'Kesh +{n} okt',

    'section.seed': 'Generatsiya kaliti',
    'section.surface': 'Sirt',
    'section.surfaceHint': 'Geologiya',
    'section.atmosphere': 'Atmosfera',
    'section.atmosphereHint': 'Sochilish',
    'section.rings': 'Halqalar',
    'section.ringsHint': 'Tizim',
    'section.orbit': 'Orbita',
    'section.orbitHint': 'Yulduz · Aylanish',
    'section.render': 'Render',
    'section.renderHint': 'Unumdorlik',

    'param.seaLevel': 'Dengiz sathi',
    'param.relief': 'Togʻ relyefi',
    'param.ice': 'Qutb muz qoplami',
    'param.cityLights': 'Sivilizatsiya chiroqlari',
    'param.cloudCover': 'Bulutlilik',
    'param.atmoDensity': 'Atmosfera zichligi',
    'param.atmoHue': 'Atmosfera tusining siljishi',
    'param.ringTilt': 'Halqalar ogʻishi',
    'param.sunAngle': 'Quyoshning orbitadagi oʻrni',
    'param.rotSpeed': 'Sayyoraning aylanish tezligi',
    'param.renderScale': 'Render masshtabi',

    'seed.randomize': 'Tasodifiy kalit',
    'rings.off': 'Halqasiz',
    'rings.on': 'Halqali',

    'hint.dragKey': 'Sichqoncha',
    'hint.drag': 'aylantirish',
    'hint.scrollKey': 'Gʻildirak',
    'hint.scroll': 'masshtab',
    'hint.reseed': 'yangi kalit',
    'hint.cinematic': 'kino rejimi',
    'toggle.hide': 'Interfeysni yashirish',
    'toggle.show': 'Interfeysni koʻrsatish',
    'toggle.title': 'Interfeysni yashirish yoki koʻrsatish (H)',

    'boot.compiling': 'Sheyderlar kompilyatsiya qilinmoqda…',
    'boot.shaderFailed': 'Sheyderlarni kompilyatsiya qilib boʻlmadi.',
    'boot.startFailed': 'Rendererni ishga tushirib boʻlmadi.',
    'boot.webgl2': 'WebGL 2 talab qilinadi.',

    'preset.terran.name': 'Terra Praym',
    'preset.terran.tag': 'M sinfi',
    'preset.terran.blurb': 'Moʻtadil iqlimli okean dunyosi. Azot-kislorodli atmosfera, faol suv aylanishi, aholi yashaydigan sohillar.',
    'preset.arrakis.name': 'Qurgʻoqchil Arrakis',
    'preset.arrakis.tag': 'H sinfi',
    'preset.arrakis.blurb': 'Barxanlar dunyosi. Chuqur kanyonlar tizimi, butun sayyorani qamraydigan oxra rang chang boʻronlari, sirtida ochiq suv yoʻq.',
    'preset.mustafar.name': 'Vulqonli Mustafar',
    'preset.mustafar.tag': 'Y sinfi',
    'preset.mustafar.blurb': 'Tortishish kuchlari taʼsirida qiziydigan bazalt qobiq. Magma dengizlari, choʻgʻdek qizigan daryolar, oltingugurtli kul bulutlari.',
    'preset.europa.name': 'Muzli Yevropa',
    'preset.europa.tag': 'P sinfi',
    'preset.europa.blurb': 'Muz osti okeanini qoplagan yoriqli muz qobigʻi. Siyrak ekzosfera, Saturnnikidek yorqin halqalar.',
    'preset.kepler.name': 'Kepler super-Yeri',
    'preset.kepler.tag': 'K sinfi',
    'preset.kepler.blurb': 'Tortishish kuchi yuqori, gullab-yashnagan dunyo. Binafsha va zumrad tusli oʻsimliklar, qalin girdobli atmosfera, keng halqalar tizimi.',
  },
};

/** The stored choice, else the first browser language we speak, else English. */
function detectLanguage() {
  const known = (id) => LANGUAGES.some((language) => language.id === id);
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (known(stored)) return stored;
  } catch (error) {
    // Storage can be unavailable (private mode, file://); fall through.
  }
  const wanted = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const tag of wanted) {
    const id = String(tag || '').toLowerCase().split('-')[0];
    if (known(id)) return id;
  }
  return 'en';
}

/**
 * Text service shared by the entry point and the HUD.
 *   t(key, vars)        the string in the current language ("{n}" placeholders)
 *   number(v, digits)   fixed-point number with the language's decimal mark
 *   set(id)             switch language, remember it, notify listeners
 *   onChange(fn)        subscribe to language switches
 */
export function createI18n() {
  let current = detectLanguage();
  const listeners = [];

  const t = (key, vars) => {
    let text = STRINGS[current][key];
    if (text === undefined) text = STRINGS.en[key];
    if (text === undefined) return key;
    if (vars) {
      for (const name in vars) text = text.replace(`{${name}}`, vars[name]);
    }
    return text;
  };

  // Static markup: data-i18n fills the text, data-i18n-aria / -title the
  // matching attributes. Also keeps <html lang> and the tab title in step.
  const applyStatic = () => {
    document.documentElement.lang = current;
    document.title = t('app.title');
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nAria));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.title = t(node.dataset.i18nTitle);
    });
  };
  applyStatic();

  return {
    get language() {
      return current;
    },
    t,
    number(value, digits) {
      const text = value.toFixed(digits);
      const mark = t('format.decimal');
      return mark === '.' ? text : text.replace('.', mark);
    },
    set(id) {
      if (id === current || !STRINGS[id]) return;
      current = id;
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, id);
      } catch (error) {
        // Not being able to remember the choice is not worth an error.
      }
      applyStatic();
      listeners.forEach((listener) => listener(id));
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
