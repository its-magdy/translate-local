// Canonical language map: BCP-47 code → display name.
// All three language lists in the codebase (CLI validation, adapter prompts,
// TUI picker) are derived from this single source of truth.
export const LANG_NAMES: Record<string, string> = {
  // aa
  aa: "Afar", "aa-dj": "Afar (Djibouti)", "aa-er": "Afar (Eritrea)",
  // ab
  ab: "Abkhazian",
  // af
  af: "Afrikaans", "af-na": "Afrikaans (Namibia)",
  // ak
  ak: "Akan",
  // am
  am: "Amharic",
  // an
  an: "Aragonese",
  // ar
  ar: "Arabic",
  "ar-ae": "Arabic (United Arab Emirates)", "ar-bh": "Arabic (Bahrain)",
  "ar-dj": "Arabic (Djibouti)", "ar-dz": "Arabic (Algeria)",
  "ar-eg": "Arabic (Egypt)", "ar-eh": "Arabic (Western Sahara)",
  "ar-er": "Arabic (Eritrea)", "ar-il": "Arabic (Israel)",
  "ar-iq": "Arabic (Iraq)", "ar-jo": "Arabic (Jordan)",
  "ar-km": "Arabic (Comoros)", "ar-kw": "Arabic (Kuwait)",
  "ar-lb": "Arabic (Lebanon)", "ar-ly": "Arabic (Libya)",
  "ar-ma": "Arabic (Morocco)", "ar-mr": "Arabic (Mauritania)",
  "ar-om": "Arabic (Oman)", "ar-ps": "Arabic (Palestine)",
  "ar-qa": "Arabic (Qatar)", "ar-sa": "Arabic (Saudi Arabia)",
  "ar-sd": "Arabic (Sudan)", "ar-so": "Arabic (Somalia)",
  "ar-ss": "Arabic (South Sudan)", "ar-sy": "Arabic (Syria)",
  "ar-td": "Arabic (Chad)", "ar-tn": "Arabic (Tunisia)",
  "ar-ye": "Arabic (Yemen)",
  // as
  as: "Assamese",
  // az
  az: "Azerbaijani",
  "az-arab": "Azerbaijani (Arabic script)", "az-arab-iq": "Azerbaijani (Arabic script, Iraq)",
  "az-arab-tr": "Azerbaijani (Arabic script, Turkey)",
  "az-cyrl": "Azerbaijani (Cyrillic)", "az-latn": "Azerbaijani (Latin)",
  // ba
  ba: "Bashkir",
  // be
  be: "Belarusian", "be-tarask": "Belarusian (Taraškievica)",
  // bg
  bg: "Bulgarian", "bg-bg": "Bulgarian (Bulgaria)",
  // bm
  bm: "Bambara", "bm-nkoo": "Bambara (N'Ko script)",
  // bn
  bn: "Bengali", "bn-in": "Bengali (India)",
  // bo
  bo: "Tibetan", "bo-in": "Tibetan (India)",
  // br
  br: "Breton",
  // bs
  bs: "Bosnian", "bs-cyrl": "Bosnian (Cyrillic)", "bs-latn": "Bosnian (Latin)",
  // ca
  ca: "Catalan",
  "ca-ad": "Catalan (Andorra)", "ca-es": "Catalan (Spain)",
  "ca-fr": "Catalan (France)", "ca-it": "Catalan (Italy)",
  // ce
  ce: "Chechen",
  // co
  co: "Corsican",
  // cs
  cs: "Czech", "cs-cz": "Czech (Czech Republic)",
  // cv
  cv: "Chuvash",
  // cy
  cy: "Welsh",
  // da
  da: "Danish", "da-dk": "Danish (Denmark)", "da-gl": "Danish (Greenland)",
  // de
  de: "German",
  "de-at": "German (Austria)", "de-be": "German (Belgium)",
  "de-ch": "German (Switzerland)", "de-de": "German (Germany)",
  "de-it": "German (Italy)", "de-li": "German (Liechtenstein)",
  "de-lu": "German (Luxembourg)",
  // dv
  dv: "Divehi",
  // dz
  dz: "Dzongkha",
  // ee
  ee: "Ewe", "ee-tg": "Ewe (Togo)",
  // el
  el: "Greek", "el-cy": "Greek (Cyprus)", "el-gr": "Greek (Greece)",
  "el-polyton": "Greek (Polytonic)",
  // en
  en: "English",
  "en-ae": "English (United Arab Emirates)", "en-ag": "English (Antigua and Barbuda)",
  "en-ai": "English (Anguilla)", "en-as": "English (American Samoa)",
  "en-at": "English (Austria)", "en-au": "English (Australia)",
  "en-bb": "English (Barbados)", "en-be": "English (Belgium)",
  "en-bi": "English (Burundi)", "en-bm": "English (Bermuda)",
  "en-bs": "English (Bahamas)", "en-bw": "English (Botswana)",
  "en-bz": "English (Belize)", "en-ca": "English (Canada)",
  "en-cc": "English (Cocos Islands)", "en-ch": "English (Switzerland)",
  "en-ck": "English (Cook Islands)", "en-cm": "English (Cameroon)",
  "en-cx": "English (Christmas Island)", "en-cy": "English (Cyprus)",
  "en-cz": "English (Czech Republic)", "en-de": "English (Germany)",
  "en-dg": "English (Diego Garcia)", "en-dk": "English (Denmark)",
  "en-dm": "English (Dominica)", "en-er": "English (Eritrea)",
  "en-es": "English (Spain)", "en-fi": "English (Finland)",
  "en-fj": "English (Fiji)", "en-fk": "English (Falkland Islands)",
  "en-fm": "English (Micronesia)", "en-fr": "English (France)",
  "en-gb": "English (United Kingdom)", "en-gd": "English (Grenada)",
  "en-gg": "English (Guernsey)", "en-gh": "English (Ghana)",
  "en-gi": "English (Gibraltar)", "en-gm": "English (Gambia)",
  "en-gs": "English (South Georgia)", "en-gu": "English (Guam)",
  "en-gy": "English (Guyana)", "en-hk": "English (Hong Kong)",
  "en-hu": "English (Hungary)", "en-id": "English (Indonesia)",
  "en-ie": "English (Ireland)", "en-il": "English (Israel)",
  "en-im": "English (Isle of Man)", "en-in": "English (India)",
  "en-io": "English (British Indian Ocean Territory)", "en-it": "English (Italy)",
  "en-je": "English (Jersey)", "en-jm": "English (Jamaica)",
  "en-ke": "English (Kenya)", "en-ki": "English (Kiribati)",
  "en-kn": "English (Saint Kitts and Nevis)", "en-ky": "English (Cayman Islands)",
  "en-lc": "English (Saint Lucia)", "en-lr": "English (Liberia)",
  "en-ls": "English (Lesotho)", "en-mg": "English (Madagascar)",
  "en-mh": "English (Marshall Islands)", "en-mo": "English (Macao)",
  "en-mp": "English (Northern Mariana Islands)", "en-ms": "English (Montserrat)",
  "en-mt": "English (Malta)", "en-mu": "English (Mauritius)",
  "en-mv": "English (Maldives)", "en-mw": "English (Malawi)",
  "en-my": "English (Malaysia)", "en-na": "English (Namibia)",
  "en-nf": "English (Norfolk Island)", "en-ng": "English (Nigeria)",
  "en-nl": "English (Netherlands)", "en-no": "English (Norway)",
  "en-nr": "English (Nauru)", "en-nu": "English (Niue)",
  "en-nz": "English (New Zealand)", "en-pg": "English (Papua New Guinea)",
  "en-ph": "English (Philippines)", "en-pk": "English (Pakistan)",
  "en-pl": "English (Poland)", "en-pn": "English (Pitcairn Islands)",
  "en-pr": "English (Puerto Rico)", "en-pt": "English (Portugal)",
  "en-pw": "English (Palau)", "en-ro": "English (Romania)",
  "en-rw": "English (Rwanda)", "en-sb": "English (Solomon Islands)",
  "en-sc": "English (Seychelles)", "en-sd": "English (Sudan)",
  "en-se": "English (Sweden)", "en-sg": "English (Singapore)",
  "en-sh": "English (Saint Helena)", "en-si": "English (Slovenia)",
  "en-sk": "English (Slovakia)", "en-sl": "English (Sierra Leone)",
  "en-ss": "English (South Sudan)", "en-sx": "English (Sint Maarten)",
  "en-sz": "English (Eswatini)", "en-tc": "English (Turks and Caicos Islands)",
  "en-tk": "English (Tokelau)", "en-to": "English (Tonga)",
  "en-tt": "English (Trinidad and Tobago)", "en-tv": "English (Tuvalu)",
  "en-tz": "English (Tanzania)", "en-ug": "English (Uganda)",
  "en-um": "English (U.S. Minor Outlying Islands)", "en-vc": "English (Saint Vincent and the Grenadines)",
  "en-vg": "English (British Virgin Islands)", "en-vi": "English (U.S. Virgin Islands)",
  "en-vu": "English (Vanuatu)", "en-ws": "English (Samoa)",
  "en-za": "English (South Africa)", "en-zm": "English (Zambia)",
  "en-zw": "English (Zimbabwe)",
  // eo
  eo: "Esperanto",
  // es
  es: "Spanish",
  "es-ar": "Spanish (Argentina)", "es-bo": "Spanish (Bolivia)",
  "es-br": "Spanish (Brazil)", "es-bz": "Spanish (Belize)",
  "es-cl": "Spanish (Chile)", "es-co": "Spanish (Colombia)",
  "es-cr": "Spanish (Costa Rica)", "es-cu": "Spanish (Cuba)",
  "es-do": "Spanish (Dominican Republic)", "es-ea": "Spanish (Ceuta and Melilla)",
  "es-ec": "Spanish (Ecuador)", "es-es": "Spanish (Spain)",
  "es-gq": "Spanish (Equatorial Guinea)", "es-gt": "Spanish (Guatemala)",
  "es-hn": "Spanish (Honduras)", "es-ic": "Spanish (Canary Islands)",
  "es-mx": "Spanish (Mexico)", "es-ni": "Spanish (Nicaragua)",
  "es-pa": "Spanish (Panama)", "es-pe": "Spanish (Peru)",
  "es-ph": "Spanish (Philippines)", "es-pr": "Spanish (Puerto Rico)",
  "es-py": "Spanish (Paraguay)", "es-sv": "Spanish (El Salvador)",
  "es-us": "Spanish (United States)", "es-uy": "Spanish (Uruguay)",
  "es-ve": "Spanish (Venezuela)",
  // et
  et: "Estonian", "et-ee": "Estonian (Estonia)",
  // eu
  eu: "Basque",
  // fa
  fa: "Persian", "fa-af": "Persian (Afghanistan)", "fa-ir": "Persian (Iran)",
  // ff
  ff: "Fulah",
  "ff-adlm": "Fulah (Adlam script)",
  "ff-adlm-bf": "Fulah (Adlam, Burkina Faso)", "ff-adlm-cm": "Fulah (Adlam, Cameroon)",
  "ff-adlm-gh": "Fulah (Adlam, Ghana)", "ff-adlm-gm": "Fulah (Adlam, Gambia)",
  "ff-adlm-gw": "Fulah (Adlam, Guinea-Bissau)", "ff-adlm-lr": "Fulah (Adlam, Liberia)",
  "ff-adlm-mr": "Fulah (Adlam, Mauritania)", "ff-adlm-ne": "Fulah (Adlam, Niger)",
  "ff-adlm-ng": "Fulah (Adlam, Nigeria)", "ff-adlm-sl": "Fulah (Adlam, Sierra Leone)",
  "ff-adlm-sn": "Fulah (Adlam, Senegal)",
  "ff-latn": "Fulah (Latin)",
  "ff-latn-bf": "Fulah (Latin, Burkina Faso)", "ff-latn-cm": "Fulah (Latin, Cameroon)",
  "ff-latn-gh": "Fulah (Latin, Ghana)", "ff-latn-gm": "Fulah (Latin, Gambia)",
  "ff-latn-gn": "Fulah (Latin, Guinea)", "ff-latn-gw": "Fulah (Latin, Guinea-Bissau)",
  "ff-latn-lr": "Fulah (Latin, Liberia)", "ff-latn-mr": "Fulah (Latin, Mauritania)",
  "ff-latn-ne": "Fulah (Latin, Niger)", "ff-latn-ng": "Fulah (Latin, Nigeria)",
  "ff-latn-sl": "Fulah (Latin, Sierra Leone)",
  // fi
  fi: "Finnish", "fi-fi": "Finnish (Finland)",
  // fil
  fil: "Filipino", "fil-ph": "Filipino (Philippines)",
  // fo
  fo: "Faroese", "fo-dk": "Faroese (Denmark)",
  // fr
  fr: "French",
  "fr-be": "French (Belgium)", "fr-bf": "French (Burkina Faso)",
  "fr-bi": "French (Burundi)", "fr-bj": "French (Benin)",
  "fr-bl": "French (Saint Barthélemy)", "fr-ca": "French (Canada)",
  "fr-cd": "French (DR Congo)", "fr-cf": "French (Central African Republic)",
  "fr-cg": "French (Republic of Congo)", "fr-ch": "French (Switzerland)",
  "fr-ci": "French (Côte d'Ivoire)", "fr-cm": "French (Cameroon)",
  "fr-dj": "French (Djibouti)", "fr-dz": "French (Algeria)",
  "fr-fr": "French (France)", "fr-ga": "French (Gabon)",
  "fr-gf": "French (French Guiana)", "fr-gn": "French (Guinea)",
  "fr-gp": "French (Guadeloupe)", "fr-gq": "French (Equatorial Guinea)",
  "fr-ht": "French (Haiti)", "fr-km": "French (Comoros)",
  "fr-lu": "French (Luxembourg)", "fr-ma": "French (Morocco)",
  "fr-mc": "French (Monaco)", "fr-mf": "French (Saint Martin)",
  "fr-mg": "French (Madagascar)", "fr-ml": "French (Mali)",
  "fr-mq": "French (Martinique)", "fr-mr": "French (Mauritania)",
  "fr-mu": "French (Mauritius)", "fr-nc": "French (New Caledonia)",
  "fr-ne": "French (Niger)", "fr-pf": "French (French Polynesia)",
  "fr-pm": "French (Saint Pierre and Miquelon)", "fr-re": "French (Réunion)",
  "fr-rw": "French (Rwanda)", "fr-sc": "French (Seychelles)",
  "fr-sn": "French (Senegal)", "fr-sy": "French (Syria)",
  "fr-td": "French (Chad)", "fr-tg": "French (Togo)",
  "fr-tn": "French (Tunisia)", "fr-vu": "French (Vanuatu)",
  "fr-wf": "French (Wallis and Futuna)", "fr-yt": "French (Mayotte)",
  // fy
  fy: "Western Frisian",
  // ga
  ga: "Irish", "ga-gb": "Irish (United Kingdom)",
  // gd
  gd: "Scottish Gaelic",
  // gl
  gl: "Galician",
  // gn
  gn: "Guarani",
  // gu
  gu: "Gujarati", "gu-in": "Gujarati (India)",
  // gv
  gv: "Manx",
  // ha
  ha: "Hausa",
  "ha-arab": "Hausa (Arabic script)", "ha-arab-sd": "Hausa (Arabic script, Sudan)",
  "ha-gh": "Hausa (Ghana)", "ha-ne": "Hausa (Niger)",
  // he
  he: "Hebrew", "he-il": "Hebrew (Israel)",
  // hi
  hi: "Hindi", "hi-in": "Hindi (India)", "hi-latn": "Hindi (Latin script)",
  // hr
  hr: "Croatian", "hr-ba": "Croatian (Bosnia and Herzegovina)", "hr-hr": "Croatian (Croatia)",
  // ht
  ht: "Haitian",
  // hu
  hu: "Hungarian", "hu-hu": "Hungarian (Hungary)",
  // hy
  hy: "Armenian",
  // ia
  ia: "Interlingua",
  // id
  id: "Indonesian", "id-id": "Indonesian (Indonesia)",
  // ie
  ie: "Interlingue",
  // ig
  ig: "Igbo",
  // ii
  ii: "Sichuan Yi",
  // ik
  ik: "Inupiaq",
  // io
  io: "Ido",
  // is
  is: "Icelandic",
  // it
  it: "Italian",
  "it-ch": "Italian (Switzerland)", "it-it": "Italian (Italy)",
  "it-sm": "Italian (San Marino)", "it-va": "Italian (Vatican City)",
  // iu
  iu: "Inuktitut", "iu-latn": "Inuktitut (Latin script)",
  // ja
  ja: "Japanese", "ja-jp": "Japanese (Japan)",
  // jv
  jv: "Javanese",
  // ka
  ka: "Georgian",
  // ki
  ki: "Kikuyu",
  // kk
  kk: "Kazakh",
  "kk-arab": "Kazakh (Arabic script)", "kk-cyrl": "Kazakh (Cyrillic)",
  "kk-kz": "Kazakh (Kazakhstan)",
  // kl
  kl: "Kalaallisut",
  // km
  km: "Central Khmer",
  // kn
  kn: "Kannada", "kn-in": "Kannada (India)",
  // ko
  ko: "Korean",
  "ko-cn": "Korean (China)", "ko-kp": "Korean (North Korea)", "ko-kr": "Korean (South Korea)",
  // ks
  ks: "Kashmiri", "ks-arab": "Kashmiri (Arabic script)", "ks-deva": "Kashmiri (Devanagari)",
  // ku
  ku: "Kurdish",
  // kw
  kw: "Cornish",
  // ky
  ky: "Kyrgyz",
  // la
  la: "Latin",
  // lb
  lb: "Luxembourgish",
  // lg
  lg: "Ganda",
  // ln
  ln: "Lingala",
  "ln-ao": "Lingala (Angola)", "ln-cf": "Lingala (Central African Republic)",
  "ln-cg": "Lingala (Republic of Congo)",
  // lo
  lo: "Lao",
  // lt
  lt: "Lithuanian", "lt-lt": "Lithuanian (Lithuania)",
  // lu
  lu: "Luba-Katanga",
  // lv
  lv: "Latvian", "lv-lv": "Latvian (Latvia)",
  // mg
  mg: "Malagasy",
  // mi
  mi: "Maori",
  // mk
  mk: "Macedonian",
  // ml
  ml: "Malayalam", "ml-in": "Malayalam (India)",
  // mn
  mn: "Mongolian",
  "mn-mong": "Mongolian (Traditional script)", "mn-mong-mn": "Mongolian (Traditional script, Mongolia)",
  // mr
  mr: "Marathi", "mr-in": "Marathi (India)",
  // ms
  ms: "Malay",
  "ms-arab": "Malay (Arabic script)", "ms-arab-bn": "Malay (Arabic script, Brunei)",
  "ms-bn": "Malay (Brunei)", "ms-id": "Malay (Indonesia)", "ms-sg": "Malay (Singapore)",
  // mt
  mt: "Maltese",
  // my
  my: "Burmese",
  // nb
  nb: "Norwegian Bokmål", "nb-sj": "Norwegian Bokmål (Svalbard and Jan Mayen)",
  // nd
  nd: "North Ndebele",
  // ne
  ne: "Nepali", "ne-in": "Nepali (India)",
  // nl
  nl: "Dutch",
  "nl-aw": "Dutch (Aruba)", "nl-be": "Dutch (Belgium)",
  "nl-bq": "Dutch (Caribbean Netherlands)", "nl-cw": "Dutch (Curaçao)",
  "nl-nl": "Dutch (Netherlands)", "nl-sr": "Dutch (Suriname)",
  "nl-sx": "Dutch (Sint Maarten)",
  // nn
  nn: "Norwegian Nynorsk",
  // no
  no: "Norwegian", "no-no": "Norwegian (Norway)",
  // nr
  nr: "South Ndebele",
  // nv
  nv: "Navajo",
  // ny
  ny: "Chichewa",
  // oc
  oc: "Occitan", "oc-es": "Occitan (Spain)",
  // om
  om: "Oromo", "om-ke": "Oromo (Kenya)",
  // or
  or: "Oriya",
  // os
  os: "Ossetian", "os-ru": "Ossetian (Russia)",
  // pa
  pa: "Punjabi",
  "pa-in": "Punjabi (India)", "pa-arab": "Punjabi (Arabic script)",
  "pa-guru": "Punjabi (Gurmukhi script)",
  // pl
  pl: "Polish", "pl-pl": "Polish (Poland)",
  // ps
  ps: "Pashto", "ps-pk": "Pashto (Pakistan)",
  // pt
  pt: "Portuguese",
  "pt-ao": "Portuguese (Angola)", "pt-br": "Portuguese (Brazil)",
  "pt-ch": "Portuguese (Switzerland)", "pt-cv": "Portuguese (Cape Verde)",
  "pt-gq": "Portuguese (Equatorial Guinea)", "pt-gw": "Portuguese (Guinea-Bissau)",
  "pt-lu": "Portuguese (Luxembourg)", "pt-mo": "Portuguese (Macao)",
  "pt-mz": "Portuguese (Mozambique)", "pt-pt": "Portuguese (Portugal)",
  "pt-st": "Portuguese (São Tomé and Príncipe)", "pt-tl": "Portuguese (Timor-Leste)",
  // qu
  qu: "Quechua", "qu-bo": "Quechua (Bolivia)", "qu-ec": "Quechua (Ecuador)",
  // rm
  rm: "Romansh",
  // rn
  rn: "Rundi",
  // ro
  ro: "Romanian", "ro-md": "Romanian (Moldova)", "ro-ro": "Romanian (Romania)",
  // ru
  ru: "Russian",
  "ru-by": "Russian (Belarus)", "ru-kg": "Russian (Kyrgyzstan)",
  "ru-kz": "Russian (Kazakhstan)", "ru-md": "Russian (Moldova)",
  "ru-ru": "Russian (Russia)", "ru-ua": "Russian (Ukraine)",
  // rw
  rw: "Kinyarwanda",
  // sa
  sa: "Sanskrit",
  // sc
  sc: "Sardinian",
  // sd
  sd: "Sindhi", "sd-arab": "Sindhi (Arabic script)", "sd-deva": "Sindhi (Devanagari)",
  // se
  se: "Northern Sami",
  "se-fi": "Northern Sami (Finland)", "se-se": "Northern Sami (Sweden)",
  // sg
  sg: "Sango",
  // si
  si: "Sinhala",
  // sk
  sk: "Slovak", "sk-sk": "Slovak (Slovakia)",
  // sl
  sl: "Slovenian", "sl-si": "Slovenian (Slovenia)",
  // sn
  sn: "Shona",
  // so
  so: "Somali",
  "so-dj": "Somali (Djibouti)", "so-et": "Somali (Ethiopia)", "so-ke": "Somali (Kenya)",
  // sq
  sq: "Albanian", "sq-mk": "Albanian (North Macedonia)", "sq-xk": "Albanian (Kosovo)",
  // sr
  sr: "Serbian", "sr-rs": "Serbian (Serbia)",
  "sr-cyrl": "Serbian (Cyrillic)", "sr-cyrl-ba": "Serbian (Cyrillic, Bosnia and Herzegovina)",
  "sr-cyrl-me": "Serbian (Cyrillic, Montenegro)", "sr-cyrl-xk": "Serbian (Cyrillic, Kosovo)",
  "sr-latn": "Serbian (Latin)", "sr-latn-ba": "Serbian (Latin, Bosnia and Herzegovina)",
  "sr-latn-me": "Serbian (Latin, Montenegro)", "sr-latn-xk": "Serbian (Latin, Kosovo)",
  // ss
  ss: "Swati", "ss-sz": "Swati (Eswatini)",
  // st
  st: "Southern Sotho", "st-ls": "Southern Sotho (Lesotho)",
  // su
  su: "Sundanese", "su-latn": "Sundanese (Latin script)",
  // sv
  sv: "Swedish",
  "sv-ax": "Swedish (Åland Islands)", "sv-fi": "Swedish (Finland)", "sv-se": "Swedish (Sweden)",
  // sw
  sw: "Swahili",
  "sw-cd": "Swahili (DR Congo)", "sw-ke": "Swahili (Kenya)",
  "sw-tz": "Swahili (Tanzania)", "sw-ug": "Swahili (Uganda)",
  // ta
  ta: "Tamil",
  "ta-in": "Tamil (India)", "ta-lk": "Tamil (Sri Lanka)",
  "ta-my": "Tamil (Malaysia)", "ta-sg": "Tamil (Singapore)",
  // te
  te: "Telugu", "te-in": "Telugu (India)",
  // tg
  tg: "Tajik",
  // th
  th: "Thai", "th-th": "Thai (Thailand)",
  // ti
  ti: "Tigrinya", "ti-er": "Tigrinya (Eritrea)",
  // tk
  tk: "Turkmen",
  // tl
  tl: "Tagalog",
  // tn
  tn: "Tswana", "tn-bw": "Tswana (Botswana)",
  // to
  to: "Tonga",
  // tr
  tr: "Turkish", "tr-cy": "Turkish (Cyprus)", "tr-tr": "Turkish (Turkey)",
  // ts
  ts: "Tsonga",
  // tt
  tt: "Tatar",
  // ug
  ug: "Uyghur",
  // uk
  uk: "Ukrainian", "uk-ua": "Ukrainian (Ukraine)",
  // ur
  ur: "Urdu", "ur-in": "Urdu (India)", "ur-pk": "Urdu (Pakistan)",
  // uz
  uz: "Uzbek",
  "uz-arab": "Uzbek (Arabic script)", "uz-cyrl": "Uzbek (Cyrillic)",
  "uz-latn": "Uzbek (Latin)",
  // ve
  ve: "Venda",
  // vi
  vi: "Vietnamese", "vi-vn": "Vietnamese (Vietnam)",
  // vo
  vo: "Volapük",
  // wa
  wa: "Walloon",
  // wo
  wo: "Wolof",
  // xh
  xh: "Xhosa",
  // yi
  yi: "Yiddish",
  // yo
  yo: "Yoruba", "yo-bj": "Yoruba (Benin)",
  // za
  za: "Zhuang",
  // zh
  zh: "Chinese",
  "zh-ch": "Chinese (Switzerland)",
  "zh-tw": "Chinese (Traditional, Taiwan)",
  "zh-hans": "Chinese (Simplified)",
  "zh-hans-hk": "Chinese (Simplified, Hong Kong)",
  "zh-hans-mo": "Chinese (Simplified, Macao)",
  "zh-hans-my": "Chinese (Simplified, Malaysia)",
  "zh-hans-sg": "Chinese (Simplified, Singapore)",
  "zh-hant": "Chinese (Traditional)",
  "zh-hant-hk": "Chinese (Traditional, Hong Kong)",
  "zh-hant-mo": "Chinese (Traditional, Macao)",
  "zh-hant-my": "Chinese (Traditional, Malaysia)",
  "zh-latn": "Chinese (Latin script)",
  // zu
  zu: "Zulu", "zu-za": "Zulu (South Africa)",
};

export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(LANG_NAMES);

export const SUPPORTED_LANGUAGE_SET = new Set(SUPPORTED_LANGUAGES);

export const DEFAULT_MODEL = "translate-gemma-12b";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
/**
 * NOTE: `~` is NOT expanded by Node/Bun. Consumers must resolve this themselves, e.g.:
 *   import os from "os"; import path from "path";
 *   path.join(os.homedir(), ".config/tl/config.jsonc")
 * Prefer the resolver functions below to avoid silent path errors.
 */
export const DEFAULT_CONFIG_PATH = "~/.config/tl/config.jsonc";
export const DEFAULT_GLOSSARY_DB_PATH = "~/.config/tl/glossary.db";
export const DEFAULT_CONTEXT_DB_PATH = "~/.config/tl/context.db";

import { join } from "path";
import { homedir } from "os";
/** Returns the resolved absolute path to the default config file. */
export function resolveConfigPath(): string { return join(homedir(), ".config/tl/config.jsonc"); }
/** Returns the resolved absolute path to the default glossary database. */
export function resolveGlossaryDbPath(): string { return join(homedir(), ".config/tl/glossary.db"); }
/** Returns the resolved absolute path to the default context database. */
export function resolveContextDbPath(): string { return join(homedir(), ".config/tl/context.db"); }
export const DEFAULT_GLOSSARY_MODE = "prefer" as const;
