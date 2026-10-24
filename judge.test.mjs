import assert from "node:assert/strict";
import { normalize, editDistance, judge } from "./judge.js";

const cases = [
  // [추측, 진짜 답, 기대 결과]
  [" 곱창 ", "곱창", "correct"], // 공백
  ["후라이드 치킨!", "후라이드치킨", "correct"], // 띄어쓰기, 특수문자
  ["Pizza", "pizza", "correct"], // 대소문자
  ["곱창이야", "곱창", "correct"], // 꼬리말
  ["라면이요", "라면", "correct"], // 꼬리말
  ["곱창", "곱참", "correct"], // 받침 오타 (자모 1개)
  ["김밥", "김발", "correct"], // 받침 오타
  ["삼겹살", "삼결살", "correct"], // 모음 오타
  ["곱창", "국밥", "wrong"], // 다른 음식
  ["밥", "빵", "wrong"], // 한 글자는 오타 허용 안 함
  ["밥", "밤", "wrong"],
  ["1988", "1989", "wrong"], // 숫자는 정확히 일치해야 함
  ["1988", "1988년", "maybe"], // 포함 관계
  ["치킨", "후라이드치킨", "maybe"], // 포함 관계
  ["곱창", "소곱창", "maybe"],
  ["고기", "소고기", "maybe"],
  ["라면", "짜장면", "wrong"],
  ["", "곱창", "wrong"], // 빈 값
  ["곱창", "   ", "wrong"],
];

let failed = 0;
for (const [guess, truth, expected] of cases) {
  const actual = judge(guess, truth);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${guess}" vs "${truth}" → ${actual}${ok ? "" : ` (기대: ${expected})`}`);
}

assert.equal(normalize("후라이드 치킨!!"), "후라이드치킨");
assert.equal(editDistance("kitten", "sitting"), 3);
assert.equal(editDistance([..."abc"], [..."abc"]), 0);

if (failed > 0) {
  console.error(`\n${failed}개 실패`);
  process.exit(1);
}
console.log(`\n전체 ${cases.length}개 통과`);
