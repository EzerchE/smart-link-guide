const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = { URL, URLSearchParams, atob, decodeURIComponent, globalThis: null };
context.globalThis = context;
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "engine.js"), "utf8"),
  context
);

const Engine = context.LinkGuideEngine;

const direct = Engine.analyzeUrl("https://short.example/go?url=https%3A%2F%2Ftarget.example%2Ffile%3Futm_source%3Dad");
assert.equal(direct.candidates[0].url, "https://target.example/file");
assert.equal(direct.candidates[0].parameter, "url");
assert.equal(direct.candidates[0].score, 95);

const encodedTarget = Buffer.from("https://files.example/download?id=42", "utf8").toString("base64url");
const encoded = Engine.analyzeUrl(`https://short.example/?r=${encodedTarget}`);
assert.equal(encoded.candidates[0].url, "https://files.example/download?id=42");

const unknownParameter = Engine.analyzeUrl("https://short.example/?payload=https%3A%2F%2Ftarget.example%2F");
assert.equal(unknownParameter.candidates[0].score, 72);

assert.equal(Engine.normalizeUrl("javascript:alert(1)"), null);
assert.equal(Engine.assessRisk("http://127.0.0.1/admin").safe, false);
assert.equal(Engine.assessRisk("https://download.example/setup.exe").level, "danger");
assert.equal(Engine.assessRisk("http://example.com/").level, "warning");
assert.equal(Engine.classifyActionText("I'M A HUMAN").eligible, true);
assert.equal(Engine.classifyActionText("GET LINK").score, 98);
assert.equal(Engine.classifyActionText("Skip Advertisement").score, 96);
assert.equal(Engine.classifyActionText("Click To Proceed").score, 92);
assert.equal(Engine.classifyActionText("on I am a human I am a human").score, 100);
assert.equal(Engine.classifyActionText("Sign in to continue").eligible, false);
assert.equal(Engine.classifyActionText("Download setup.exe").eligible, false);
assert.equal(Engine.shouldFollowActionHref("https://gate.example/path#", "https://gate.example/path"), false);
assert.equal(Engine.shouldFollowActionHref("https://target.example/file", "https://gate.example/path"), true);
assert.equal(Engine.isContainerPage("https://filecrypt.cc/Container/ABC.html"), true);
assert.equal(Engine.isContainerPage("https://www.keeplinks.org/p16/token"), true);
assert.equal(Engine.isPlausibleCaptchaAnswer("a"), false);
assert.equal(Engine.isPlausibleCaptchaAnswer("a7B4"), true);
assert.equal(Engine.isPlausibleCaptchaAnswer("1234", { minLength: 6 }), false);
assert.equal(Engine.isPlausibleCaptchaAnswer("123456", { minLength: 6, maxLength: 6, pattern: "[0-9]+" }), true);
assert.equal(Engine.isPlausibleCaptchaAnswer("12ab56", { minLength: 6, maxLength: 6, pattern: "[0-9]+" }), false);
assert.equal(Engine.detectsAntiAdblockMessage("Ads Blocker Detected! Please disable your ad blocker."), true);
assert.equal(Engine.detectsAntiAdblockMessage("Reklam engelleyiciyi kapatın ve devam edin."), true);
assert.equal(Engine.detectsAntiAdblockMessage("A guide to privacy-friendly advertising"), false);
assert.equal(Engine.classifyActionText("Click Image & Wait 7 seconds").reason, "Sayaç başlatma adımı");
assert.equal(Engine.classifyActionText("Click on below Button to start counter").reason, "Sayaç başlatma adımı");
assert.equal(Engine.classifyActionText("Click here to verify").reason, "Sayaç başlatma adımı");
assert.ok(Engine.classifyActionText("Click here to verify").score > Engine.classifyActionText("FAST DOWNLOAD").score);
assert.equal(Engine.classifyActionText("Görsele tıkla ve bekle").reason, "Sayaç başlatma adımı");
assert.equal(Engine.requiresNaturalTiming("https://jump.example/goto/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/token"), true);
assert.equal(Engine.requiresNaturalTiming("https://jump.example/go/short"), false);
assert.equal(Engine.detectsTransitionError('{"status":"error","message":"Bad Request.","url":""}', "application/json"), true);
assert.equal(Engine.detectsTransitionError("An article discussing HTTP bad request errors in detail", "text/html"), false);
assert.equal(
  Engine.canonicalKey("https://example.com/path?b=2&utm_source=x&a=1#part"),
  "https://example.com/path?a=1&b=2"
);

process.stdout.write("engine tests passed\n");
