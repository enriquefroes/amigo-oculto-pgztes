// Amigo Oculto Pgzetes — API (Netlify Functions + Netlify Blobs)
// Variáveis de ambiente obrigatórias no Netlify:
//   SESSION_SECRET  texto longo e aleatório (assina as sessões)
//   GROUP_CODE      código que você passa no grupo para a galera conseguir se cadastrar
//   ADMIN_USER      seu usuário (o organizador), em minúsculas
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const SIZES = ["PP", "P", "M", "G", "GG", "XGG", "Infantil"];
const USER_RE = /^[a-z0-9._-]{3,20}$/;
const MAX_MEMBERS = 60;
const SESSION_DAYS = 60;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (msg, status = 400) => json({ error: msg }, status);

const store = () => getStore({ name: "amigo-oculto-pgzetes", consistency: "strong" });
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? "").trim();

// ---------- utilidades ----------
const b64u = (buf) => Buffer.from(buf).toString("base64url");
function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return { salt: b64u(salt), hash: b64u(hash) };
}
function checkPassword(password, rec) {
  const { hash } = hashPassword(password, Buffer.from(rec.salt, "base64url"));
  const a = Buffer.from(hash, "base64url"), b = Buffer.from(rec.hash, "base64url");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac("sha256", env("SESSION_SECRET")).update(body).digest());
  return body + "." + mac;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expect = b64u(crypto.createHmac("sha256", env("SESSION_SECRET")).update(body).digest());
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const cleanVetoes = (v) => {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const t = clean(x, 40);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 20) break;
  }
  return out;
};
const isJwk = (k) => k && typeof k === "object" && k.kty === "RSA" && typeof k.n === "string" && typeof k.e === "string";
const isEncPriv = (e) => e && typeof e === "object" && ["salt", "iv", "data"].every((k) => typeof e[k] === "string" && e[k].length < 8000);

// ---------- dados ----------
const userKey = (u) => "users/" + u;
async function getUser(s, u) { return (await s.get(userKey(u), { type: "json" })) || null; }
async function putUser(s, rec) { await s.setJSON(userKey(rec.username), rec); }
async function allUsers(s) {
  const { blobs } = await s.list({ prefix: "users/" });
  const recs = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return recs.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
const publicProfile = (u) => ({
  username: u.username, name: u.name, team: u.team || "", size: u.size || "", vetoes: u.vetoes || [], wish: u.wish || "",
  createdAt: u.createdAt, hasKey: !!u.pubKey,
});
const isAdmin = (u) => u.username === env("ADMIN_USER").toLowerCase();
function session(u) { return sign({ u: u.username, v: u.tokenVersion || 0, exp: Date.now() + SESSION_DAYS * 864e5 }); }

async function authed(req, s) {
  const h = req.headers.get("authorization") || "";
  const p = verify(h.replace(/^Bearer\s+/i, ""));
  if (!p) return null;
  const u = await getUser(s, p.u);
  if (!u || (u.tokenVersion || 0) !== p.v) return null;
  return u;
}

// ---------- rotas ----------
export default async (req) => {
  if (!env("SESSION_SECRET") || env("SESSION_SECRET").length < 16 || !env("GROUP_CODE") || !env("ADMIN_USER"))
    return fail("Site ainda não configurado: defina SESSION_SECRET, GROUP_CODE e ADMIN_USER nas variáveis de ambiente do Netlify.", 500);
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const s = store();
  let body = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { return fail("Pedido inválido."); } }

  try {
    // --- cadastro ---
    if (route === "register" && req.method === "POST") {
      const username = clean(body.username, 20).toLowerCase();
      if (clean(body.groupCode, 100) !== env("GROUP_CODE")) return fail("Código do grupo incorreto. Peça o código ao organizador.", 403);
      if (!USER_RE.test(username)) return fail("Usuário deve ter de 3 a 20 caracteres: letras minúsculas, números, ponto, hífen ou _.");
      if (String(body.password || "").length < 6) return fail("A senha precisa ter pelo menos 6 caracteres.");
      const name = clean(body.name, 40);
      if (!name) return fail("Coloque seu nome ou apelido.");
      if (!isJwk(body.pubKey) || !isEncPriv(body.encPriv)) return fail("Não deu para criar sua chave. Atualize a página e tente de novo.");
      if (await getUser(s, username)) return fail("Esse usuário já existe. Escolha outro ou entre com sua senha.", 409);
      const { blobs } = await s.list({ prefix: "users/" });
      if (blobs.length >= MAX_MEMBERS) return fail("O grupo já está cheio.", 403);
      const rec = {
        username, name, team: "", size: "", vetoes: [], wish: "",
        pw: hashPassword(body.password), pubKey: body.pubKey, encPriv: body.encPriv,
        tokenVersion: 0, failed: 0, lockUntil: 0, createdAt: new Date().toISOString(),
      };
      await putUser(s, rec);
      return json({ token: session(rec), encPriv: rec.encPriv });
    }

    // --- login ---
    if (route === "login" && req.method === "POST") {
      const username = clean(body.username, 20).toLowerCase();
      const u = USER_RE.test(username) ? await getUser(s, username) : null;
      if (!u) return fail("Usuário ou senha incorretos.", 401);
      if (u.lockUntil > Date.now()) return fail("Muitas tentativas erradas. Espere 15 minutos ou peça ao organizador para resetar sua senha.", 429);
      if (!checkPassword(body.password, u.pw)) {
        u.failed = (u.failed || 0) + 1;
        if (u.failed >= 8) { u.failed = 0; u.lockUntil = Date.now() + 15 * 60e3; }
        await putUser(s, u);
        return fail("Usuário ou senha incorretos.", 401);
      }
      if (u.failed || u.lockUntil) { u.failed = 0; u.lockUntil = 0; await putUser(s, u); }
      return json({ token: session(u), encPriv: u.encPriv || null, mustChange: !!u.mustChange });
    }

    const me = await authed(req, s);
    if (!me) return fail("Sua sessão expirou. Entre de novo.", 401);

    // --- estado geral ---
    if (route === "state" && req.method === "GET") {
      const [users, draw, config] = await Promise.all([allUsers(s), s.get("draw", { type: "json" }), s.get("config", { type: "json" })]);
      const d = draw && draw.status === "drawn"
        ? { status: "drawn", round: draw.round, drawnAt: draw.drawnAt, participants: draw.participants, mine: draw.pairs[me.username] || null }
        : { status: "open" };
      return json({ me: { ...publicProfile(me), mustChange: !!me.mustChange }, isAdmin: isAdmin(me), members: users.map(publicProfile), draw: d, config: config || {} });
    }

    // --- minha ficha ---
    if (route === "profile" && req.method === "POST") {
      const name = clean(body.name, 40);
      if (!name) return fail("Coloque seu nome ou apelido.");
      const size = SIZES.includes(body.size) ? body.size : "";
      if (!size) return fail("Escolha o tamanho da camisa.");
      Object.assign(me, { name, size, team: clean(body.team, 40), vetoes: cleanVetoes(body.vetoes), wish: clean(body.wish, 240), updatedAt: new Date().toISOString() });
      await putUser(s, me);
      return json({ ok: true });
    }

    // --- nova chave (depois de reset de senha) ---
    if (route === "keys" && req.method === "POST") {
      if (!isJwk(body.pubKey) || !isEncPriv(body.encPriv)) return fail("Chave inválida.");
      me.pubKey = body.pubKey; me.encPriv = body.encPriv;
      await putUser(s, me);
      return json({ ok: true });
    }

    // --- trocar senha (a chave é recriptografada no navegador) ---
    if (route === "password" && req.method === "POST") {
      if (!checkPassword(body.oldPassword, me.pw)) return fail("Senha atual incorreta.", 401);
      if (String(body.newPassword || "").length < 6) return fail("A nova senha precisa ter pelo menos 6 caracteres.");
      if (!isEncPriv(body.encPriv)) return fail("Chave inválida.");
      me.pw = hashPassword(body.newPassword); me.encPriv = body.encPriv; me.mustChange = false;
      me.tokenVersion = (me.tokenVersion || 0) + 1;
      await putUser(s, me);
      return json({ token: session(me) });
    }

    // ---------- organizador ----------
    if (route.startsWith("admin/")) {
      if (!isAdmin(me)) return fail("Só o organizador pode fazer isso.", 403);
      const action = route.slice(6);

      if (action === "draw" && req.method === "POST") {
        // O sorteio acontece aqui no servidor, sem nada voltar para o organizador:
        // cada resultado é trancado com a chave pública do próprio participante
        // e só os resultados trancados são guardados.
        const users = (await allUsers(s)).filter((u) => u.pubKey);
        if (users.length < 3) return fail("Precisa de pelo menos 3 participantes com acesso ativo.");
        const order = users.map((u) => u.username);
        for (let i = order.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
        const keyOf = Object.fromEntries(users.map((u) => [u.username, u.pubKey]));
        const round = crypto.randomBytes(12).toString("hex");
        const pairs = {};
        // um único círculo embaralhado: cada um presenteia o próximo, então ninguém tira a si mesmo
        for (let i = 0; i < order.length; i++) {
          const giver = order[i], target = order[(i + 1) % order.length];
          const { alg, key_ops, ext, ...jwk } = keyOf[giver];
          const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
          pairs[giver] = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
            Buffer.from(JSON.stringify({ t: target, r: round }))).toString("base64");
        }
        const participants = order.slice().sort(); // ordem alfabética: não revela o círculo
        await s.setJSON("draw", { status: "drawn", round, drawnAt: new Date().toISOString(), participants, pairs });
        return json({ ok: true, count: participants.length });
      }
      if (action === "reopen" && req.method === "POST") {
        await s.setJSON("draw", { status: "open" });
        return json({ ok: true });
      }
      if (action === "config" && req.method === "POST") {
        await s.setJSON("config", { valor: clean(body.valor, 40), data: clean(body.data, 40) });
        return json({ ok: true });
      }
      if (action === "remove" && req.method === "POST") {
        const u = clean(body.username, 20).toLowerCase();
        if (u === me.username) return fail("Você não pode remover a si mesmo.");
        await s.delete(userKey(u));
        return json({ ok: true });
      }
      if (action === "reset" && req.method === "POST") {
        const u = await getUser(s, clean(body.username, 20).toLowerCase());
        if (!u) return fail("Participante não encontrado.", 404);
        const temp = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
        u.pw = hashPassword(temp); u.mustChange = true; u.failed = 0; u.lockUntil = 0;
        u.pubKey = null; u.encPriv = null; // a chave antiga dependia da senha antiga
        u.tokenVersion = (u.tokenVersion || 0) + 1;
        await putUser(s, u);
        return json({ tempPassword: temp });
      }
    }
    return fail("Rota não encontrada.", 404);
  } catch (err) {
    console.error(err);
    return fail("Erro no servidor. Tente de novo em instantes.", 500);
  }
};

export const config = { path: "/api/*" };
