# 검품 운영 콘솔 (Inspection Operations Console)

검품 앱이 기록한 **실제 운영 데이터**를 조회하고, 필요한 경우 수량을 안전하게 보정하는 콘솔입니다.
자체 데이터는 보관하지 않습니다.

## 화면

| 화면 | 내용 |
| --- | --- |
| 검품 내역 | 협력사별(ㄱ→ㅎ) 그룹 + 발주/검품/검품률/회송/교환/불량사유/사진. 필터·정렬·고정 헤더. 행을 누르면 오른쪽에 상세(사진 큰 미리보기), 수량 보정 |
| 회송 / 교환 | 같은 구조. 협력사별 그룹, 구분·센터·조치 필터 |
| 이력 | 일별 검품 KPI 요약 (최신순, 일자 열 고정) |
| 저장 / 복구 상태 | 네이티브 저장 영수증 조회, 복구 요청, 수량 보정 반영 확인 |
| 기준정보 | 만들지 않았습니다. 검품 앱의 admin grid로 **링크**만 합니다 |

## 화면 사용법

- **기본 보기는 협력사별 가나다순**입니다. `(주)`, `㈜`, `영농조합법인`, `농업회사법인` 같은 법인 표기는 정렬에서만
  빼서, `(주)엘제이농산`은 ㅇ, `영농조합법인신우유통`은 ㅅ 아래에 놓입니다. 표시되는 이름은 원본 그대로입니다.
  한글 → 영문 → 숫자 순이며 브라우저마다 달라지지 않도록 직접 고정했습니다.
- 협력사 헤더를 누르면 접고 펼칩니다. `ㄱ ㄷ ㅁ …` 바로가기, `ㄱ→ㅎ / ㅎ→ㄱ`, `모두 접기`가 있습니다.
- **필터**: 작업 범위(오늘/전체)와 job, 검색, 협력사(다중·검색), DPT(다중), 검품 완료/미검품, 이슈(회송·교환·
  불량사유), 사진 유무. 조건은 AND로 겹치고, `필터 초기화 (n)`이 몇 개가 걸려 있는지 보여줍니다.
- **고정 헤더**: 제목·필터·컬럼 헤더·현재 협력사 헤더가 스크롤해도 따라옵니다. 행만 스크롤됩니다.
- 상세 패널은 왼쪽 경계를 끌어서 폭을 조절합니다(300~640px, 기억됨). 키보드는 ←/→.
- 상품명은 최소 300px를 확보합니다. 그보다 좁아지면 잘라내지 않고 가로 스크롤합니다.

## 설계

Supabase와 R2에 직접 접속하지 않습니다. 모든 읽기/쓰기는 검품 앱의 `POST {INSPECTION_APP_BASE}/api/gas`를
거칩니다. 그 엔드포인트가 이미 식별자 정규화(job base key, canonical partner, record id), 수량 state
machine과 CAS, 회송/교환 state machine, 네이티브 저장 영수증을 들고 있습니다. 여기서 다시 구현하면 두
번째 writer가 되고, 한 군데라도 어긋나면 정규 행이 깨집니다.

서버 간 통신이라 `Origin` 헤더가 없고, 검품 앱의 origin allowlist에 이 콘솔을 넣을 필요가 없습니다. 세션
토큰은 서버 밖으로 나가지 않습니다. 모든 요청에 `clientPlatform: "service"`와 `caller`를 붙여 최소
클라이언트 버전 게이트를 통과합니다 (Inspection Dashboard와 같은 방식).

사진은 `{INSPECTION_APP_BASE}/api/photo?id=...&sz=w320`에서 직접 불러옵니다. 서명된 id 자체가 capability라
헤더가 필요 없어서, 함수를 거치지 않고 `<img>`가 바로 받습니다.

### 사용하는 action

`getInspectionRows` · `getReturnExchangeRecords` · `getHistoryData` · `saveInspectionQtyFastBatch` ·
`confirmInspectionQty` · `getNativeWriteStatus` · `recoverNativeWrite`

### 운영 응답에서 확인된 사실 (2026-10-23, 읽기 전용 검증)

소스 코드만 읽고 짠 가정과 실제 응답은 달랐습니다. 아래는 실제 운영 응답으로 확인한 내용입니다.

| 항목 | 실제 |
| --- | --- |
| 검품 행 필드 | `센터명`, `불량수량`, `비고`가 **없음**. 불량은 `불량사유` + `회송수량` + `교환수량`, 분류는 `DPT명` |
| 사진 필드 | `photoFileIds`(배열) / `사진파일ID목록`(줄바꿈 구분). id는 `r2_<uuid>_<hash>` 56자 |
| 사진 표시 | `{INSPECTION_APP_BASE}/api/photo?id=…&sz=w320` 익명 호출로 JPEG 200 (w320 약 17KB) |
| 필터 | **`date`, `selectedCenter`는 무시됨.** `filterMode`만 유효: `current`=오늘 job(296행), `all`=보관된 전 job(9개, 1,890행) |
| 회송/교환 | `records` 키. 구분은 `처리유형`, 수량은 `회송수량`/`교환수량`, 상태는 `effectiveActionStatus`. `current`는 비어 있을 수 있어 기본은 `all` |
| 이력 | 행 단위 이력이 아니라 **일별 KPI 요약**(195일, 오래된 순). 화면에서 최신순으로 뒤집어 표시 |
| 영수증 | `operationId`와 `payloadHash`가 **둘 다 필수**. 없으면 `NATIVE_WRITE_INVALID` |
| `getCurrentJob` | 응답 3.5MB(원가 포함). Vercel 응답 한도(4.5MB)에 근접하고 화면에도 필요 없어 프록시하지 않음 |

## 안전 보정

수량 보정은 이 콘솔의 유일한 쓰기이고, 의도적으로 좁게 만들었습니다.

1. 화면에서 보고 있던 수량을 `baseQty`로 함께 보냅니다. 그 사이 다른 사람이 고쳤다면 검품 앱의 state
   machine이 거부합니다 — 조용히 덮어쓰지 않습니다.
2. `requestId`는 `qty-<timestamp>-<id>` 형식입니다. 검품 앱이 이 prefix에서 쓰기 순서를 읽기 때문에
   형식이 다르면 순서 보장이 사라집니다. 서버가 형식을 강제합니다.
3. 수량 0은 빈 값이 아니라 실제 보정이므로 `explicitZero`를 함께 보냅니다.
4. 저장 후 `confirmInspectionQty`로 **원본 행을 다시 읽어** 이 요청이 반영됐는지 판정합니다.

**응답이 유실되거나 PENDING으로 끝나면 다시 저장하지 않습니다.** 이미 반영됐을 수 있기 때문에, 읽어서
확인합니다 — 행 확인(`confirmInspectionQty`) 또는 영수증 조회(`getNativeWriteStatus`). 그래도 불확실하면
`recoverNativeWrite`로 검품 앱에 확정을 요청합니다.

## 환경 변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 예 | 콘솔 로그인 비밀번호. 없으면 503으로 로그인 거부 |
| `SESSION_SECRET` | 운영에서 필수 | 세션 쿠키 서명 키. 없으면 부팅 시 임의 생성 |
| `INSPECTION_APP_BASE` | 예 | 검품 앱 origin. 예: `https://inspection-app-main.vercel.app` |
| `INSPECTION_SESSION_TOKEN` | 예 | 검품 앱이 발급한 세션 토큰. 권한은 검품 앱이 이 토큰으로 판단 |
| `CORRECTIONS_ENABLED` | 아니오 | `true`일 때만 수량 보정·복구 요청 가능. 기본은 조회 전용 |
| `ADMIN_ID` | 아니오 | 기본 `admin` |
| `INSPECTION_TIMEOUT_MS` | 아니오 | 기본 30000 |

연결 변수가 없으면 콘솔은 **데이터를 지어내지 않고 503**으로 응답하고 누락 변수를 화면에 표시합니다.

## 실행

```powershell
npm install
npm run dev
```

## 검증

```powershell
npm test
```

`scripts/test-model.ts`(가나다 정렬·그룹·필터·요약, 합성 데이터)와 `scripts/test-console.ts`(API)를 돌립니다.
후자는 검품 앱 프로토콜을 흉내 내는 stub이며 **운영 데이터에 접속하지 않습니다.**
확인 항목: 필터 전달, service caller 표기, 보정 가드(baseQty 누락 / 음수 / 소수 / jobKey 누락 /
requestId 형식 2종)가 앱에 도달하지 않고 거부되는지, CAS base와 requestId가 변형 없이 전달되는지,
`explicitZero`, PENDING이 실패로 둔갑하지 않는지, 보정 게이트, 미설정 시 503.

## 배포

Vercel 프로젝트 `gs-dash-board`를 재사용합니다. Vercel Authentication(SSO)이 `all`이라 외부에서 접근할 수
없습니다.

## 이력

이 저장소는 이전에 **GS Dashboard**(전단행사 운영 대시보드)였습니다. 당시 상태는 태그에 보존되어 있습니다.

```text
archive/gs-dashboard-2026-10-22
```
