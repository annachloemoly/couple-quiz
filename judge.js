// 정답 판정 로직: 정규화 → 오타 허용(자모 단위 편집 거리) → 포함 관계(애매함)
// 결과: "correct" | "maybe" | "wrong"

const TAILS = /(이에요|예요|입니다|이야|이다|이요|요)$/;

/** 비교하기 좋게 문자열을 깨끗하게 만든다. */
export function normalize(text) {
  const s = String(text ?? "")
    .normalize("NFC") // 자모가 분리되어 들어온 한글을 합침
    .toLowerCase() // 영문 소문자 통일
    .replace(/[^\p{L}\p{N}]/gu, ""); // 글자·숫자 외(공백, 특수문자 등) 제거
  const stripped = s.replace(TAILS, ""); // "곱창이야" → "곱창"
  return stripped.length >= 2 ? stripped : s; // 너무 짧아지면 원래대로
}

/** 두 배열(또는 문자열)의 편집 거리: 넣기/빼기/바꾸기 각각 1 */
export function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

// 한글 한 글자를 자모(초성/중성/종성)로 분해한다. (NFD)
const toJamo = (s) => Array.from(s.normalize("NFD"));

// 자모 길이에 따라 허용하는 오타 개수
// 한 글자(자모 3개 이하)는 0, 두세 글자는 1, 긴 단어는 2
function allowedDistance(jamoLen) {
  if (jamoLen <= 3) return 0;
  if (jamoLen <= 8) return 1;
  return 2;
}

/**
 * guess(추측)와 truth(본인이 쓴 진짜 답)를 비교한다.
 * - correct: 정규화 후 일치하거나 오타 허용 범위 안
 * - maybe: 한쪽이 다른 쪽을 포함 (예: 곱창 / 소곱창) → 사람이 판정
 * - wrong: 그 외
 */
export function judge(guess, truth) {
  const x = normalize(guess);
  const y = normalize(truth);
  if (!x || !y) return "wrong";
  if (x === y) return "correct";

  // 숫자가 들어간 답(연도, 나이 등)은 오타 허용 없이 정확히 일치해야 한다.
  const hasDigit = /\p{N}/u.test(x) || /\p{N}/u.test(y);
  const jx = toJamo(x);
  const jy = toJamo(y);
  const allowed = hasDigit ? 0 : allowedDistance(Math.max(jx.length, jy.length));
  if (allowed > 0 && editDistance(jx, jy) <= allowed) return "correct";

  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  if (shorter.length >= 2 && longer.includes(shorter)) return "maybe";

  return "wrong";
}
