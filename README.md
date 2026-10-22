# 검품 마스터 콘솔 (Inspection Master Console)

검품 운영 기준정보를 조회하고 수정하는 콘솔입니다. 기존 Google Sheet가 들고 있던 탭들을 그대로 다루며,
자체 데이터는 보관하지 않습니다.

> **먼저 읽어 주세요.** 이 기능은 `inspection-app-main`에 **이미 존재합니다** (Admin Spreadsheet /
> admin grid, `api/_lib/app/adminGrid.js`). 이 저장소는 그 API를 호출하는 **두 번째 UI**입니다.
> 검증 로직을 복제하지 않은 이유는 아래 [설계](#설계) 참고.

## 데이터셋

검품 앱의 `adminGrid.DATASETS`와 같은 8개입니다.

| key | 이름 |
| --- | --- |
| `work_schedule` | 근무표 |
| `reservation_rows` | 사전예약 |
| `product_master` | 상품 기준정보 |
| `partner_category_master` | 파트너 기준정보 |
| `event_rows` | 행사표 |
| `mapping_rows` | 협력사 별칭 매핑 |
| `exclude_rows` | 제외목록 |
| `inspection_criteria` | 검품 기준 |

## 설계

이 콘솔은 **Supabase에 직접 접속하지 않습니다.** 모든 읽기/쓰기는 검품 앱의
`POST {INSPECTION_APP_BASE}/api/admin-grid`를 거칩니다.

그 이유는 검증 로직 때문입니다. 검품 앱의 `adminGrid.normalize()`는 정규 데이터를 지키는 규칙을 들고
있습니다 — `inspection_criteria`의 기존 AI 정량 규칙 보존, 중복 규칙 탐지, `사용여부` TRUE/FALSE 정규화,
상품코드 정규화, 사전예약 발주수량 검사, 근무표 월 헤더 파싱, `수정자`/`수정일시` 서버 각인. 이걸 여기서
다시 구현해 `app_grid_decide`를 직접 호출하면, 한 군데라도 다른 순간 마스터 데이터가 조용히 깨집니다.
그래서 **쓰기 주체는 검품 앱 하나로 유지**합니다.

호출은 서버 간 통신입니다. 브라우저는 same-origin `/api/*`만 부르고, 검품 앱 세션 토큰은 서버 밖으로
나가지 않습니다. `Origin` 헤더가 없으므로 검품 앱의 origin allowlist에 이 콘솔을 추가할 필요도 없습니다.
요청에는 `clientPlatform: "service"`와 `caller: "inspection-master-console"`를 붙여, 최소 클라이언트
버전 게이트가 이를 구버전 앱으로 오인하지 않게 합니다 (Inspection Dashboard와 같은 방식).

## 저장 흐름

1. **검토** — `previewAdminGrid`. 아무것도 쓰지 않고 셀 단위 오류·경고·변경 건수만 받습니다.
2. **저장** — `saveAdminGrid`. 검토할 때 쓴 `revision` + `sourceHash`를 그대로 보냅니다.

그 사이 다른 사람이 수정했다면 `NATIVE_WRITE_CONFLICT`로 거부되고 아무것도 쓰이지 않습니다.
`operationId`는 멱등 키라서, 응답이 유실돼 재시도해도 두 번 저장되지 않습니다.

## 환경 변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 예 | 콘솔 로그인 비밀번호. 없으면 503으로 로그인 거부 |
| `SESSION_SECRET` | 운영에서 필수 | 세션 쿠키 서명 키. 없으면 부팅 시 임의 생성 |
| `INSPECTION_APP_BASE` | 예 | 검품 앱 origin. 예: `https://inspection-app-main.vercel.app` |
| `INSPECTION_SESSION_TOKEN` | 예 | 검품 앱이 발급한 세션 토큰. 권한은 검품 앱이 이 토큰으로 판단 |
| `MASTER_WRITES_ENABLED` | 아니오 | `true`일 때만 수정 가능. 기본은 읽기 전용 |
| `ADMIN_ID` | 아니오 | 기본 `admin` |
| `INSPECTION_TIMEOUT_MS` | 아니오 | 기본 30000 |

연결 변수가 없으면 콘솔은 **데이터를 지어내지 않고 503**으로 응답하고 화면에 누락 변수를 표시합니다.

## 실행

```powershell
npm install
npm run dev
```

## 검증

```powershell
npm test
```

검품 앱 프로토콜을 흉내 내는 stub을 띄워서 확인합니다. 운영 데이터에 접속하지 않습니다.
확인 항목: CAS(`revision`+`sourceHash`) 전달, 잘못된 CAS 거부, 데이터셋 allowlist, `operationId` 멱등 전달,
`nativeWrite` 형식, service caller 표기, 쓰기 게이트, 오류 코드 → HTTP 상태 매핑, 미설정 시 503.

## 배포

Vercel 프로젝트 `gs-dash-board`를 재사용합니다. Vercel Authentication(SSO)이 `all`로 켜져 있어
외부에서는 접근할 수 없습니다.

## 이력

이 저장소는 이전에 **GS Dashboard**(전단행사 운영 대시보드)였습니다. 당시 상태는 태그에 보존되어 있습니다.

```text
archive/gs-dashboard-2026-10-22
```
