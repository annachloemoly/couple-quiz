import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, push, remove, onValue, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { judge } from "./judge.js";
import { DEFAULT_QUESTIONS } from "./questions.js";

const TOTAL_QUESTIONS = 10;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 제외
const STORAGE_ROOM = "qb_room";
const STORAGE_NAME = "qb_name";

const app = document.getElementById("app");
const state = { db: null, uid: null, code: null, role: null, room: null, unsub: null, lastKey: null };

/* ------------------------------ 유틸 ------------------------------ */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const otherRole = (r) => (r === "host" ? "guest" : "host");
const genCode = () =>
  Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const nameOf = (role) => state.room?.players?.[role]?.name || (role === "host" ? "방장" : "상대");
const getQuestions = (room) => (room.questions ? Object.values(room.questions) : []);
const roomRef = (path = "") => ref(state.db, `rooms/${state.code}${path ? "/" + path : ""}`);

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function showError(err) {
  console.error(err);
  const text = `${err?.code || ""} ${err?.message || ""}`;
  if (/permission[_ ]denied/i.test(text)) {
    toast("권한 오류예요. Firebase 보안 규칙과 익명 로그인 설정을 확인해주세요.");
  } else {
    toast(err?.message || "알 수 없는 오류가 생겼어요.");
  }
}

/* ------------------------------ 시작 ------------------------------ */

const isConfigured = () =>
  firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("YOUR_");

async function ensureAuth(auth) {
  if (auth.currentUser) return auth.currentUser.uid;
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) return resolve(user.uid);
      try {
        const cred = await signInAnonymously(auth);
        resolve(cred.user.uid);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function main() {
  if (!isConfigured()) return renderSetup();

  try {
    const fbApp = initializeApp(firebaseConfig);
    state.db = getDatabase(fbApp);
    state.uid = await ensureAuth(getAuth(fbApp));
  } catch (e) {
    console.error(e);
    app.innerHTML = `<section class="card"><h2>연결에 실패했어요</h2>
      <p class="hint">Firebase에서 <b>익명 로그인</b>이 켜져 있는지, 현재 도메인이 <b>승인된 도메인</b>에 있는지 확인해주세요.</p>
      <pre>${esc(e.code || e.message)}</pre></section>`;
    return;
  }

  bindGlobalClicks();

  const params = new URLSearchParams(location.search);
  const invite = (params.get("room") || "").toUpperCase();
  const saved = localStorage.getItem(STORAGE_ROOM);

  if (saved && (!invite || invite === saved)) {
    try {
      const snap = await get(ref(state.db, `rooms/${saved}`));
      const players = snap.exists() ? snap.val().players || {} : {};
      const role = players.host?.uid === state.uid ? "host" : players.guest?.uid === state.uid ? "guest" : null;
      if (role) return enterRoom(saved, role);
    } catch (e) {
      console.error(e);
    }
    localStorage.removeItem(STORAGE_ROOM);
  }
  renderHome(invite);
}

function renderSetup() {
  app.innerHTML = `<section class="card">
    <h2>🔧 Firebase 설정이 필요해요</h2>
    <p class="hint"><b>firebase-config.js</b> 파일의 값을 본인 Firebase 프로젝트 값으로 바꿔주세요. 자세한 순서는 README.md에 있어요.</p>
  </section>`;
}

/* ------------------------------ 방 입장/퇴장 ------------------------------ */

function enterRoom(code, role) {
  state.code = code;
  state.role = role;
  state.room = null;
  state.lastKey = null;
  localStorage.setItem(STORAGE_ROOM, code);
  history.replaceState(null, "", location.pathname);

  app.innerHTML = `<section class="card"><p class="hint">방에 연결하는 중…</p></section>`;
  state.unsub = onValue(
    roomRef(),
    (snap) => {
      const v = snap.val();
      if (!v) {
        toast("방이 사라졌어요.");
        leaveRoom();
        return;
      }
      state.room = v;
      render();
    },
    (err) => showError(err)
  );
}

function leaveRoom() {
  if (state.unsub) state.unsub();
  state.unsub = null;
  state.code = null;
  state.role = null;
  state.room = null;
  state.lastKey = null;
  localStorage.removeItem(STORAGE_ROOM);
  renderHome();
}

async function createRoom(name) {
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    try {
      await set(ref(state.db, `rooms/${code}`), {
        createdAt: serverTimestamp(),
        status: "lobby",
        players: { host: { uid: state.uid, name } },
      });
      return enterRoom(code, "host");
    } catch (e) {
      if (i === 4) throw e; // 코드가 겹쳤을 때만 재시도, 계속 실패하면 오류로
    }
  }
}

async function joinRoom(rawCode, name) {
  const code = rawCode.trim().toUpperCase();
  if (code.length !== 6) throw new Error("방 코드는 6자리예요.");

  const snap = await get(ref(state.db, `rooms/${code}`));
  if (!snap.exists()) throw new Error("그런 방이 없어요. 코드를 다시 확인해주세요.");

  const players = snap.val().players || {};
  if (players.host?.uid === state.uid) {
    await update(ref(state.db, `rooms/${code}/players/host`), { name });
    return enterRoom(code, "host");
  }
  if (players.guest?.uid === state.uid) {
    await update(ref(state.db, `rooms/${code}/players/guest`), { name });
    return enterRoom(code, "guest");
  }
  if (players.guest) throw new Error("이미 두 명이 들어와 있는 방이에요.");

  try {
    await set(ref(state.db, `rooms/${code}/players/guest`), { uid: state.uid, name });
  } catch {
    throw new Error("참가하지 못했어요. 이미 가득 찬 방일 수 있어요.");
  }
  enterRoom(code, "guest");
}

/* ------------------------------ 게임 동작 ------------------------------ */

async function startGame() {
  const room = state.room;
  const customs = shuffle(Object.values(room.customQuestions || {}).map((c) => c.text)).slice(0, TOTAL_QUESTIONS);
  const defaults = shuffle(DEFAULT_QUESTIONS).slice(0, TOTAL_QUESTIONS - customs.length);
  const questions = shuffle([...customs, ...defaults]);
  await update(roomRef(), { questions, current: 0, status: "playing" });
}

async function addCustomQuestion(text) {
  await push(roomRef("customQuestions"), { text, by: state.role });
}

async function setVerdict(q, guesser, value) {
  await set(roomRef(`verdicts/${q}/${guesser}`), value);
}

async function nextQuestion(q) {
  // 두 사람이 동시에 눌러도 한 번만 넘어가도록 트랜잭션 사용
  await runTransaction(roomRef("current"), (cur) => (cur === null || cur === q ? q + 1 : undefined));
}

async function copyInvite() {
  const url = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("초대 링크를 복사했어요!");
  } catch {
    toast(url);
  }
}

/* ------------------------------ 판정 결과 계산 ------------------------------ */

// guesser가 owner(상대)의 진짜 답을 얼마나 맞혔는지
function outcome(room, q, guesser) {
  const a = room.answers?.[q];
  const owner = otherRole(guesser);
  if (!a?.[guesser] || !a?.[owner]) return null;

  const guess = a[guesser].guess;
  const truth = a[owner].self;
  const res = judge(guess, truth); // correct | maybe | wrong
  const verdict = room.verdicts?.[q]?.[guesser]; // 진짜 답 주인이 내린 판정: "yes" | "no" | undefined

  let st;
  if (res === "correct" || verdict === "yes") st = "ok";
  else if (res === "maybe" && verdict === undefined) st = "pending";
  else st = "no";

  return { guess, truth, res, verdict, state: st, owner };
}

function computeScores(room) {
  const score = { host: 0, guest: 0 };
  const rows = getQuestions(room).map((text, q) => {
    const h = outcome(room, q, "host");
    const g = outcome(room, q, "guest");
    if (h?.state === "ok") score.host++;
    if (g?.state === "ok") score.guest++;
    return { text, h, g };
  });
  return { score, rows };
}

/* ------------------------------ 렌더링 ------------------------------ */

function render() {
  const room = state.room;
  if (!room) return;
  const qs = getQuestions(room);

  let key, mount, update;
  if (room.status !== "playing") {
    key = "lobby"; mount = mountLobby; update = updateLobby;
  } else if ((room.current ?? 0) >= qs.length) {
    key = "final"; mount = mountFinal;
  } else {
    const q = room.current ?? 0;
    const text = qs[q];
    const a = room.answers?.[q] || {};
    const mine = !!a[state.role];
    const theirs = !!a[otherRole(state.role)];
    if (!mine) {
      key = `q${q}-answer`; mount = () => mountAnswer(q, text); update = () => updateStatus(q);
    } else if (!theirs) {
      key = `q${q}-wait`; mount = () => mountWait(q, text); update = () => updateStatus(q);
    } else {
      key = `q${q}-reveal-${JSON.stringify(room.verdicts?.[q] || {})}`;
      mount = () => mountReveal(q, text);
    }
  }

  // 화면이 바뀔 때만 통째로 다시 그려서, 입력 중인 내용이 지워지지 않게 한다.
  if (key !== state.lastKey) {
    state.lastKey = key;
    mount();
  }
  if (update) update();
}

/* ---- 홈 ---- */

function renderHome(prefillCode = "") {
  state.lastKey = "home";
  const savedName = localStorage.getItem(STORAGE_NAME) || "";
  app.innerHTML = `<section class="card">
    <h1>💌 우리 퀴즈 배틀</h1>
    <p class="sub">서로를 얼마나 알까? 방 코드로 둘이 실시간으로 겨뤄요.</p>
    <label for="name">내 이름</label>
    <input id="name" type="text" maxlength="12" autocomplete="off" placeholder="예: 민수" value="${esc(savedName)}">
    <button id="create" class="primary">방 만들기</button>
    <div class="divider">또는 초대받았다면</div>
    <form id="joinForm">
      <label for="code">방 코드</label>
      <div class="row">
        <input id="code" type="text" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="ABC123" value="${esc(prefillCode)}">
        <button type="submit">참가</button>
      </div>
    </form>
  </section>`;

  const nameInput = document.getElementById("name");
  const getName = () => {
    const name = nameInput.value.trim();
    if (!name) {
      toast("이름을 먼저 입력해주세요.");
      nameInput.focus();
      return null;
    }
    localStorage.setItem(STORAGE_NAME, name);
    return name;
  };

  document.getElementById("create").addEventListener("click", async (e) => {
    const name = getName();
    if (!name) return;
    e.target.disabled = true;
    try {
      await createRoom(name);
    } catch (err) {
      e.target.disabled = false;
      showError(err);
    }
  });

  document.getElementById("joinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = getName();
    if (!name) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await joinRoom(document.getElementById("code").value, name);
    } catch (err) {
      btn.disabled = false;
      showError(err);
    }
  });

  if (prefillCode && !savedName) nameInput.focus();
}

/* ---- 로비 ---- */

function mountLobby() {
  app.innerHTML = `<section class="card">
    <h2>방 코드</h2>
    <div class="code">${esc(state.code)}</div>
    <button class="primary" style="margin-top:0" data-act="copy">초대 링크 복사</button>

    <h3>참가자</h3>
    <ul class="list" id="players"></ul>

    <h3>우리만의 질문 추가 <small class="muted">(선택)</small></h3>
    <p class="hint">"처음 데이트한 곳은?"처럼 써주세요. 기본 질문과 섞여 총 ${TOTAL_QUESTIONS}문제가 나와요.</p>
    <form id="qForm" class="row">
      <input id="qInput" type="text" maxlength="60" autocomplete="off" placeholder="둘만 아는 질문을 적어보세요">
      <button type="submit">추가</button>
    </form>
    <ul class="list" id="customList"></ul>

    <div id="startArea"></div>
    <button class="link" data-act="leave">나가기</button>
  </section>`;

  document.getElementById("qForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("qInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await addCustomQuestion(text);
    } catch (err) {
      input.value = text;
      showError(err);
    }
  });
}

function updateLobby() {
  const room = state.room;
  const players = room.players || {};

  document.getElementById("players").innerHTML = ["host", "guest"]
    .map((r) =>
      players[r]
        ? `<li><span>${r === "host" ? "👑" : "🙂"} ${esc(players[r].name)}${r === state.role ? " (나)" : ""}</span></li>`
        : `<li class="muted"><span>⏳ 상대를 기다리는 중…</span></li>`
    )
    .join("");

  const customs = Object.entries(room.customQuestions || {});
  document.getElementById("customList").innerHTML = customs.length
    ? customs
        .map(
          ([id, c]) => `<li>
            <span>${esc(c.text)} <small class="muted">— ${esc(nameOf(c.by))}</small></span>
            ${c.by === state.role ? `<button class="x" data-del="${esc(id)}" aria-label="삭제">✕</button>` : ""}
          </li>`
        )
        .join("")
    : `<li class="muted"><span>아직 없어요</span></li>`;

  const ready = !!players.guest;
  document.getElementById("startArea").innerHTML =
    state.role === "host"
      ? `<button class="primary" data-act="start" ${ready ? "" : "disabled"}>${ready ? "게임 시작" : "상대가 들어오면 시작할 수 있어요"}</button>`
      : `<p class="hint">방장이 시작하면 바로 퀴즈가 나와요 🎮</p>`;
}

/* ---- 문제: 답 입력 ---- */

function mountAnswer(q, text) {
  const total = getQuestions(state.room).length;
  const them = nameOf(otherRole(state.role));
  app.innerHTML = `<section class="card">
    <div class="progress">${q + 1} / ${total}</div>
    <h2 class="qtext">${esc(text)}</h2>
    <form id="aForm">
      <label for="selfInput">나는 (내 진짜 답)</label>
      <input id="selfInput" type="text" maxlength="40" autocomplete="off">
      <label for="guessInput">${esc(them)}의 답은 아마 (맞혀보기)</label>
      <input id="guessInput" type="text" maxlength="40" autocomplete="off">
      <button class="primary" type="submit">제출</button>
    </form>
    <p class="hint" id="partnerStatus"></p>
  </section>`;

  const form = document.getElementById("aForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const self = document.getElementById("selfInput").value.trim();
    const guess = document.getElementById("guessInput").value.trim();
    if (!self || !guess) return toast("두 칸 모두 입력해주세요.");
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await set(roomRef(`answers/${q}/${state.role}`), { self, guess, at: serverTimestamp() });
    } catch (err) {
      btn.disabled = false;
      showError(err);
    }
  });
  document.getElementById("selfInput").focus();
}

function mountWait(q, text) {
  const total = getQuestions(state.room).length;
  app.innerHTML = `<section class="card">
    <div class="progress">${q + 1} / ${total}</div>
    <h2 class="qtext">${esc(text)}</h2>
    <p>제출했어요! 둘 다 제출하면 동시에 공개돼요 👀</p>
    <p class="hint" id="partnerStatus"></p>
  </section>`;
}

function updateStatus(q) {
  const el = document.getElementById("partnerStatus");
  if (!el) return;
  const theirs = !!state.room.answers?.[q]?.[otherRole(state.role)];
  const name = nameOf(otherRole(state.role));
  el.textContent = theirs ? `✅ ${name}님은 이미 입력했어요` : `✍️ ${name}님이 입력하는 중이에요…`;
}

/* ---- 문제: 결과 공개 ---- */

function dirCard(q, guesser) {
  const o = outcome(state.room, q, guesser);
  const isOwner = state.role === o.owner;

  const label =
    o.state === "ok" ? (o.res === "correct" ? "정답! 🎉" : "인정! 🎉") : o.state === "pending" ? "판정 대기 ⏳" : "아쉬워요 😅";

  const btn = (val, text, cls = "") =>
    `<button class="${cls}" data-act="verdict" data-q="${q}" data-who="${guesser}" data-val="${val}">${text}</button>`;

  let actions = "";
  if (isOwner && o.res !== "correct") {
    if (o.res === "maybe" && o.verdict === undefined) {
      actions = `<p class="hint">비슷해 보여요! 같은 답으로 쳐줄까요?</p>
        <div class="actions">${btn("yes", "같은 걸로 인정 ✅")}${btn("no", "다른 거야 ❌", "ghost")}</div>`;
    } else if (o.verdict !== "yes") {
      actions = `<div class="actions">${btn("yes", "그래도 인정하기", "ghost")}</div>`;
    }
  } else if (o.state === "pending") {
    actions = `<p class="hint">${esc(nameOf(o.owner))}님이 판정 중이에요…</p>`;
  }

  return `<div class="dir ${o.state}">
    <div class="who">${esc(nameOf(guesser))}님의 추측</div>
    <div class="ans">${esc(o.guess)}</div>
    <div class="who">${esc(nameOf(o.owner))}님의 진짜 답</div>
    <div class="ans">${esc(o.truth)}</div>
    <div class="badge">${label}</div>
    ${actions}
  </div>`;
}

function mountReveal(q, text) {
  const room = state.room;
  const total = getQuestions(room).length;
  const pending = ["host", "guest"].some((g) => outcome(room, q, g)?.state === "pending");
  const last = q + 1 >= total;

  app.innerHTML = `<section class="card">
    <div class="progress">${q + 1} / ${total}</div>
    <h2 class="qtext">${esc(text)}</h2>
    ${["host", "guest"].map((g) => dirCard(q, g)).join("")}
    <button class="primary" data-act="next" data-q="${q}" ${pending ? "disabled" : ""}>
      ${pending ? "판정이 끝나면 넘어갈 수 있어요" : last ? "결과 보기" : "다음 문제"}
    </button>
  </section>`;
}

/* ---- 최종 결과 ---- */

function mountFinal() {
  const room = state.room;
  const total = getQuestions(room).length;
  const { score, rows } = computeScores(room);
  const ratio = (score.host + score.guest) / (2 * total);
  const headline =
    ratio >= 0.8 ? "천생연분이에요 🥰" : ratio >= 0.5 ? "꽤 잘 아는 사이 😊" : ratio >= 0.25 ? "아직 알아갈 게 많아요 🌱" : "오늘부터 1일 😂";
  const mark = (o) => (o?.state === "ok" ? "✅" : "❌");

  app.innerHTML = `<section class="card">
    <h2>결과</h2>
    <div class="headline">${headline}</div>
    <div class="scoreboard">
      <div class="score"><div class="num">${score.host}/${total}</div><div class="lbl">${esc(nameOf("host"))}님이 맞힌 수</div></div>
      <div class="score"><div class="num">${score.guest}/${total}</div><div class="lbl">${esc(nameOf("guest"))}님이 맞힌 수</div></div>
    </div>
    <h3>문제별 기록</h3>
    <ul class="list recap">
      ${rows
        .map(
          (r) => `<li><span>${esc(r.text)}</span>
            <span class="marks">${esc(nameOf("host"))} ${mark(r.h)} · ${esc(nameOf("guest"))} ${mark(r.g)}</span></li>`
        )
        .join("")}
    </ul>
    <button class="primary" data-act="leave">새 게임 하기</button>
  </section>`;
}

/* ------------------------------ 클릭 이벤트(위임) ------------------------------ */

function bindGlobalClicks() {
  app.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act],[data-del]");
    if (!el || el.disabled) return;
    try {
      if (el.dataset.del) {
        await remove(roomRef(`customQuestions/${el.dataset.del}`));
        return;
      }
      switch (el.dataset.act) {
        case "start": el.disabled = true; await startGame(); break;
        case "copy": await copyInvite(); break;
        case "leave": leaveRoom(); break;
        case "next": el.disabled = true; await nextQuestion(Number(el.dataset.q)); break;
        case "verdict": await setVerdict(Number(el.dataset.q), el.dataset.who, el.dataset.val); break;
      }
    } catch (err) {
      el.disabled = false;
      showError(err);
    }
  });
}

main();
