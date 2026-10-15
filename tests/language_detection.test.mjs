import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = readFileSync(new URL("../LyricsService.js", import.meta.url), "utf8");
const block = (start) => {
    const index = source.indexOf(start);
    assert.ok(index >= 0, `missing: ${start}`);
    let depth = 0;
    for (let cursor = source.indexOf("{", index); cursor < source.length; cursor++) {
        if (source[cursor] === "{") depth++;
        else if (source[cursor] === "}" && --depth === 0) return source.slice(index, cursor + 1);
    }
    throw new Error(`unbalanced: ${start}`);
};
const modelAndRules = source.slice(source.indexOf("    const LanguageModel = (() => {"), source.indexOf("    const Utils = {"));
assert.ok(modelAndRules.includes("const LanguageRefiner"), "LanguageModel and LanguageRefiner sit right before Utils");

// A stand-in for tinyld: answers fixed rankings, honoring the `only` filter.
const stubModel = (rankingFor) => ({
    detectAll: (text, { only } = {}) => rankingFor(text).filter((entry) => !only || only.includes(entry.lang)),
});

function load({ fetchImpl, importImpl, integrity } = {}) {
    const events = [];
    const window = {
        dispatchEvent: (event) => events.push(event.type),
        __ivLyricsLanguageModelImport: importImpl || (async () => { throw new Error("no import in tests"); }),
    };
    const context = vm.createContext({
        window,
        Spicetify: { LocalStorage: { get: () => null } },
        fetch: fetchImpl,
        crypto: fetchImpl ? webcrypto : undefined,
        btoa,
        URL: { createObjectURL: () => "blob:language-model", revokeObjectURL() { } },
        Blob,
        CustomEvent: class { constructor(type) { this.type = type; } },
        console: { warn: () => { } },
        setTimeout,
    });
    const code = integrity
        ? modelAndRules.replace(/const INTEGRITY = "[^"]+";/, `const INTEGRITY = "${integrity}";`)
        : modelAndRules;
    vm.runInContext(`${block("    const getLyricsTextCacheHash = (text) => {")};
${code}
globalThis.Utils = { _langDetectCache: new Map(), _maxLangCacheSize: 500,
    _cacheLanguageResult(key, result) { this._langDetectCache.set(key, result); },
${block("        detectLanguage(lyrics) {")},
${block("        detectLanguageByRules(lyrics) {")} };
globalThis.LanguageModel = LanguageModel;`, context);
    return { Utils: context.Utils, LanguageModel: context.LanguageModel, events };
}

// Detect with the model "loaded" (or with the rules only).
function detector(model = null) {
    const loaded = load();
    loaded.LanguageModel.get = () => model;
    loaded.LanguageModel.load = () => Promise.resolve(model);
    return (lines) => loaded.Utils.detectLanguage(lines.map((text) => ({ text })));
}

test("languages with their own script need no model", () => {
    const detect = detector();
    assert.equal(detect(["Σ' αγαπώ πολύ", "μείνε μαζί μου απόψε", "η νύχτα είναι δική μας"]), "el");
    assert.equal(detect(["אני אוהב אותך", "תישארי איתי הלילה", "הלילה הוא שלנו"]), "he");
    assert.equal(detect(["நான் உன்னை காதலிக்கிறேன்", "இன்று இரவு என்னுடன் இரு", "இந்த இரவு நமது"]), "ta");
    assert.equal(detect(["მიყვარხარ", "დარჩი ჩემთან ამაღამ", "ეს ღამე ჩვენია"]), "ka");
});

test("Cyrillic lyrics are told apart by their own letters", () => {
    const detect = detector();
    assert.equal(detect(["Я тебе кохаю і чекаю", "Ти моя зоря, моє життя", "Ніч така довга без тебе"]), "uk");
    assert.equal(detect(["Я тебя люблю и жду", "Ты моя звезда, моя жизнь", "Ночь такая длинная без тебя, ты слышишь"]), "ru");
    assert.equal(detect(["Волим те и чекам те", "Ноћ је дуга без тебе", "Ти си моја ђурђевданска звезда"]), "sr");
    assert.equal(detect(["Я цябе кахаю", "Ты мая зорка, маё жыццё", "Ноч такая доўгая без цябе"]), "be");
    assert.equal(detect(["Мен сені сүйемін", "Сен менің жұлдызымсың", "Түн ұзақ сенсіз"]), "kk");
    // Bulgarian has no letters of its own; the model separates it from Russian.
    const bulgarian = ["Обичам те и те чакам", "Ти си моята звезда, моят живот", "Нощта е толкова дълга без теб"];
    assert.equal(detect(bulgarian), "ru", "without the model the rules answer Russian");
    assert.equal(detector(stubModel(() => [{ lang: "bg", accuracy: 0.9 }, { lang: "ru", accuracy: 0.1 }]))(bulgarian), "bg");
    // Real case: an Oxxxymiron track with one Kazakh guest verse read as Kazakh.
    const russianVerse = ["Старый город спит под тонким слоем снега", "Я иду по крышам, не боясь упасть",
        "Каждый фонарь здесь помнит наши разговоры", "Мы писали песни на обрывках старых карт",
        "И пока трамваи тихо едут в парк", "Я считаю звёзды, что упали в наш двор"];
    const russianWithGuest = [...russianVerse, ...russianVerse.map((line) => `${line}, да`), ...russianVerse.map((line) => `${line}, нет`),
        "Қалам қолымда, сөзім жүректе", "Біздің қала түнде ұйықтамайды"];
    assert.equal(detect(russianWithGuest), "ru");
});

test("Cyrillic lyrics are put to the model line by line too", () => {
    // Real case: Klava Koka's "Покинула чат", where a one-word hook sung
    // over and over pulled the whole-song answer to Kazakh.
    const hook = "Бум бум бум бум";
    const model = stubModel((text) => (text.includes("\n") || text === hook
        ? [{ lang: "kk", accuracy: 0.9 }] : [{ lang: "ru", accuracy: 0.8 }, { lang: "bg", accuracy: 0.2 }]));
    assert.equal(detector(model)(["Ты опять звонишь мне ночью", "Телефон горит в руке", "Я молчу и слушаю дождь",
        "Он стучит по крыше", ...Array(12).fill(hook), "Завтра будет новый день", "Мы начнём его с нуля"]), "ru");
});

test("Arabic-script lyrics separate Arabic, Persian and Urdu", () => {
    const detect = detector();
    assert.equal(detect(["أحبك يا حبيبي", "ابقى معي هذه الليلة", "الليل طويل من غيرك"]), "ar");
    assert.equal(detect(["دوستت دارم عزیزم", "پیش من بمان امشب", "شب بی تو چقدر طولانی است"]), "fa");
    // Urdu was reported as Persian: it shares Persian's letters but adds its own.
    assert.equal(detect(["میں تم سے پیار کرتا ہوں", "آج رات میرے ساتھ رہو", "تمہارے بغیر رات بہت لمبی ہے"]), "ur");
});

test("Devanagari lyrics separate Hindi and Marathi", () => {
    const detect = detector();
    assert.equal(detect(["मैं तुमसे प्यार करता हूँ", "तुम मेरी जान हो", "यह रात तुम्हारे बिना लंबी है"]), "hi");
    assert.equal(detect(["माझं तुझ्यावर प्रेम आहे", "तू माझी आहेस आणि मी तुझा", "ही रात्र तुझ्याशिवाय खूप लांब आहे, नाही का"]), "mr");
});

test("Japanese, Korean and Chinese keep the original analysis; credit lines are ignored", () => {
    const detect = detector();
    assert.equal(detect(["夜空に光る星を見て", "君のことを想っている", "いつまでも一緒にいたい"]), "ja");
    assert.equal(detect(["너를 사랑해", "오늘 밤 나와 함께 있어줘", "이 밤은 우리의 것"]), "ko");
    assert.equal(detect(["作词 : 某人", "作曲 : 某人", "编曲 : 某人", "夜空に光る星を見て", "君のことを想っている"]), "ja",
        "credit lines in Chinese do not outvote the lyric");
});

test("Latin lyrics trust the model where the word scorer has no answer", () => {
    const romanian = ["Te iubesc și te aștept", "Noaptea e lungă fără tine", "Rămâi cu mine în seara asta"];
    assert.equal(detector(stubModel(() => [{ lang: "ro", accuracy: 0.95 }]))(romanian), "ro");
    const norwegian = ["Jeg elsker deg og venter på deg", "Natten er lang uten deg", "Bli hos meg i kveld"];
    assert.equal(detector(stubModel(() => [{ lang: "no", accuracy: 0.7 }, { lang: "sv", accuracy: 0.2 }]))(norwegian), "no");
});

test("the model is asked line by line, so a repeated hook cannot outvote the verses", () => {
    // Real cases: asked about whole songs at once, tinyld read Rosalía's
    // "La noche de anoche" as Hungarian and a Finnish ballad as Tagalog.
    const verses = [
        "Bailamos hasta que salió el sol",
        "Y la ciudad entera se quedó dormida",
        "Tu risa sonaba más fuerte que la música",
        "No quiero que se acabe esta noche",
    ];
    const hook = "Eh-eh, eh-eh, eh-eh";
    const asked = [];
    const model = stubModel((text) => {
        asked.push(text);
        if (text.includes("\n")) return [{ lang: "hu", accuracy: 0.6 }, { lang: "es", accuracy: 0.4 }];
        return text === hook ? [{ lang: "hu", accuracy: 1 }] : [{ lang: "es", accuracy: 0.9 }, { lang: "pt", accuracy: 0.1 }];
    });
    const song = [...verses, ...Array(20).fill(hook), ...verses];
    assert.equal(detector(model)(song), "es");
    assert.ok(asked.every((text) => !text.includes("\n")), "never asked about the whole song at once");
    assert.equal(asked.filter((text) => text === hook).length, 1, "each distinct line is asked once");
    // The original word scorer no longer overrides the model on Latin text:
    // on 900+ labeled songs it was wrong more often than right (it named
    // Portuguese sertanejo and a Dutch ballad French).
    const dutch = ["Hij liep met een gitaar door de stad", "Hij zong voor iedereen die bleef staan", "Soms vrolijk en soms een beetje stil", "De straatmuzikant"];
    assert.equal(detector(stubModel(() => [{ lang: "nl", accuracy: 1 }]))(dutch), "nl");
});

test("letters settle Turkish and rule out Icelandic", () => {
    // Real case: the model called a Turkish song with dozens of ğ and ı Icelandic.
    const turkish = ["Gidiyorum bütün aşklar yüreğimde", "Sana korkular bıraktım", "Ağlıyorum ışıkların altında"];
    assert.equal(detector(stubModel(() => [{ lang: "is", accuracy: 0.95 }, { lang: "tr", accuracy: 0.05 }]))(turkish), "tr");
    const english = ["walk with me tonight", "under the city lights", "we never sleep at all"];
    assert.equal(detector(stubModel(() => [{ lang: "is", accuracy: 0.6 }, { lang: "en", accuracy: 0.4 }]))(english), "en",
        "Icelandic is never written without ð or þ");
});

test("languages the model lacks: Azerbaijani by ə, Albanian by its function words", () => {
    // Real cases: Aygün Kazımova read as Turkish, Rona Nishliu's "Suus" as Dutch.
    const azerbaijani = ["Gecələr səni düşünürəm", "Ürəyim sənin adını çəkir", "Sən gələndə dünya gözəl olur"];
    assert.equal(detector(stubModel(() => [{ lang: "tr", accuracy: 0.9 }]))(azerbaijani), "az");
    const albanian = ["Unë të pres në breg të detit", "Nata është e gjatë pa ty", "Kjo zemër nuk harron", "Për ty këndoj një këngë"];
    assert.equal(detector(stubModel(() => [{ lang: "nl", accuracy: 0.5 }]))(albanian), "sq");
    const dutch = ["België is mijn land", "de ideeën van de zee", "Noël komt naar huis vannacht"];
    assert.equal(detector(stubModel(() => [{ lang: "nl", accuracy: 0.9 }]))(dutch), "nl", "ë alone is not Albanian");
});

test("close pairs the model cannot split: Catalan, Croatian, Malay", () => {
    const catalan = ["Jo vull estar amb tu aquesta nit", "perquè ets el meu amor i també el meu món",
        "no puc dormir sense tu, encara pensem en demà"];
    assert.equal(detector(stubModel(() => [{ lang: "es", accuracy: 0.5 }, { lang: "it", accuracy: 0.4 }]))(catalan), "ca");
    // tinyld reads most Catalan lines as French or Vietnamese.
    assert.equal(detector(stubModel(() => [{ lang: "fr", accuracy: 1 }]))(catalan), "ca");
    const spanish = ["Yo quiero estar contigo esta noche", "porque eres mi amor y también mi mundo", "no puedo dormir sin ti"];
    assert.equal(detector(stubModel(() => [{ lang: "es", accuracy: 0.9 }]))(spanish), "es");
    // Portuguese shares meu and teu with Catalan (Dulce Pontes, "Canção do Mar").
    const portuguese = ["Levei o meu barco até ao fim do cais", "o meu amor ficou a ver o mar", "e o vento trouxe o teu nome",
        "guardei a luz do teu olhar", "no meu peito o meu fado", "meu coração ainda espera"];
    assert.equal(detector(stubModel(() => [{ lang: "pt", accuracy: 0.96 }]))(portuguese), "pt");

    const serbianModel = stubModel(() => [{ lang: "sr", accuracy: 0.9 }]);
    assert.equal(detector(serbianModel)(["Lijepa si kao vrijeme proljeća", "uvijek ću te voljeti", "ti si moje dijete sreće"]), "hr");
    assert.equal(detector(serbianModel)(["Lepa si kao vreme proleća", "uvek ću te voleti", "ti si moje dete sreće"]), "sr");
    // "nije" and case endings (kategorije) are written the same in both.
    assert.equal(detector(serbianModel)(["Nisi vise dete, znas", "soba bez kategorije", "to nije ljubav",
        "nije ni bilo", "reci mi sta hoces"]), "sr");
    // Catalan read as Portuguese line by line (The Tyets, "Fa dies").
    const balearic = ["Fa temps que vull tornar a la mar", "Encara penso en tu cada nit",
        "Quan arribi l'estiu serem més a prop", "Al teu costat no em falta res", "Només vull caminar amb tu",
        "I també sé que és molt tard"];
    assert.equal(detector(stubModel(() => [{ lang: "pt", accuracy: 0.6 }]))(balearic), "ca");

    const indonesianModel = stubModel(() => [{ lang: "id", accuracy: 0.9 }]);
    assert.equal(detector(indonesianModel)(["Awak tahu kerana aku sayang", "aku nak awak tahu", "boleh tak awak mahu bersama"]), "ms");
    assert.equal(detector(indonesianModel)(["Kamu tahu karena aku sayang", "aku mau kamu tahu", "bisa nggak kita bersama"]), "id");
});

test("romanized lyrics report the language they are written in", () => {
    const tagalog = stubModel(() => [{ lang: "tl", accuracy: 0.95 }]);
    const hindi = ["Tum mere dil ki dhadkan ho", "tere bina kya hai zindagi", "main tujhe kabhi na bhoolunga yaara",
        "jab tum saath ho toh sab hai"];
    assert.equal(detector(tagalog)(hindi), "hi", "dense Hindi words beat a confident Tagalog guess");
    assert.equal(detector()(hindi), "hi", "and the rules alone already catch it");
    const arabizi = ["Ya 7abibi enti 3omri", "nhebek barcha w galbi m3ak", "rani nestanna fik kol lila"];
    assert.equal(detector(stubModel(() => [{ lang: "tl", accuracy: 0.5 }]))(arabizi), "ar");
});

test("romanized checks do not fire on ordinary lyrics", () => {
    const english = stubModel(() => [{ lang: "en", accuracy: 0.98 }]);
    assert.equal(detector(english)(["I hum along in the main street", "the trash bin is full tonight",
        "my heart beats for you", "you are the only one I need"]), "en");
    // A Norwegian song with one Arabic hook word repeated is still Norwegian.
    const norwegian = stubModel(() => [{ lang: "no", accuracy: 0.7 }]);
    assert.equal(detector(norwegian)(["Jeg går hjem i natt, 3layk", "3layk, 3layk, alltid 3layk", "byen sover når jeg går",
        "vi er unge og vi lever nå"]), "no");
});

test("an answer given before the model loads is revisited once it has", () => {
    const loaded = load();
    let model = null;
    let loadCalls = 0;
    loaded.LanguageModel.get = () => model;
    loaded.LanguageModel.load = () => { loadCalls++; return Promise.resolve(model); };
    const romanian = ["Te iubesc și te aștept", "Noaptea e lungă fără tine", "Rămâi cu mine în seara asta"]
        .map((text) => ({ text }));
    const before = loaded.Utils.detectLanguage(romanian);
    assert.notEqual(before, "ro", "the rules have no Romanian");
    assert.equal(loadCalls, 1, "first use starts loading the model");
    model = stubModel(() => [{ lang: "ro", accuracy: 0.95 }]);
    assert.equal(loaded.Utils.detectLanguage(romanian), "ro");
    assert.equal(loaded.Utils.detectLanguage(romanian), "ro", "and is cached");
});

test("the model only runs after its SHA-384 matches the pinned file", async () => {
    const bytes = new TextEncoder().encode("export const detectAll = () => [];").buffer;
    const digest = new Uint8Array(await webcrypto.subtle.digest("SHA-384", bytes));
    const integrity = `sha384-${btoa(String.fromCharCode(...digest))}`;
    const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => bytes });
    const module = { detectAll: () => [] };

    const imports = [];
    const tampered = load({ fetchImpl, importImpl: async (url) => { imports.push(url); return module; } });
    assert.equal(await tampered.LanguageModel.load(), null, "the shipped hash does not match these bytes");
    assert.deepEqual(imports, [], "nothing unverified is imported");

    const verified = load({ fetchImpl, integrity, importImpl: async (url) => { imports.push(url); return module; } });
    assert.equal(await verified.LanguageModel.load(), module);
    assert.deepEqual(imports, ["blob:language-model"]);
    assert.deepEqual(verified.events, ["ivLyrics:language-model-ready"]);

    // A policy that refuses blob: modules falls back to the verified pinned URL.
    const urls = [];
    const blocked = load({ fetchImpl, integrity, importImpl: async (url) => {
        urls.push(url);
        if (url.startsWith("blob:")) throw new Error("blocked by CSP");
        return module;
    } });
    assert.equal(await blocked.LanguageModel.load(), module);
    assert.match(urls[1], /^https:\/\/cdn\.jsdelivr\.net\/npm\/tinyld@1\.3\.4\/dist\/tinyld\.normal\.browser\.js$/);
});

test("an unreachable CDN falls back to the mirror, then to the rules", async () => {
    const requested = [];
    const offline = load({ fetchImpl: async (url) => { requested.push(url); throw new Error("offline"); } });
    assert.equal(await offline.LanguageModel.load(), null);
    assert.equal(requested.length, 2);
    assert.match(requested[1], /^https:\/\/unpkg\.com\/tinyld@1\.3\.4\//);
    const slow = load({ fetchImpl: () => new Promise(() => { }) });
    assert.equal(await slow.LanguageModel.whenReady(20), null, "waiting is bounded");
    assert.equal(await load().LanguageModel.load(), null, "no fetch available: rules only");
});
