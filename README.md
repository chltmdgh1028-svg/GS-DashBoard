# GS Dashboard

전단행사 운영 대시보드 프로토타입입니다. ADMIN이 Local Agent로 로컬 폴더의 업무 Excel을 읽어 Campaign Revision을 반영하고, OFC는 중앙 서버에 저장된 Active Snapshot만 조회합니다.

## 구조

- Web/Central Server: 로그인, 권한 Scope, Campaign Revision 저장, Dashboard API 제공
- Local Agent: 관리자 PC의 지정 폴더를 직접 읽고 기존 Excel Parser/KPI/Validation 로직으로 Snapshot 생성
- OFC: Excel 원시자료와 Local Agent 없이 중앙 Dashboard API만 조회

중앙 서버는 관리자 PC의 로컬 폴더 경로를 저장하지 않습니다. 폴더 경로와 마지막 반영 파일 hash는 각 PC의 Local Agent 설정에만 저장됩니다.

## 실행

```powershell
npm install
npm run server
```

다른 터미널에서 Local Agent를 실행합니다.

```powershell
npm run agent
```

기본 Agent 주소는 `http://127.0.0.1:8787`입니다. 기본 입력 폴더는 `C:\GS-Dashboard\Input`입니다. ADMIN 화면의 `[폴더 선택]` 버튼은 Local Agent를 통해 Windows 폴더 선택 창을 열고, 선택 경로를 해당 PC의 Agent 설정에 저장합니다.

## 테스트 계정

- ADMIN: `admin / admin`
- OFC: Campaign 반영 후 조직도 기준 `본인이름 / 본인이름`

## 보안 메모

- 브라우저 Excel 첨부 업로드와 붙여넣기 입력 API는 운영 UI/API에서 제거했습니다.
- Local Agent는 기본적으로 `127.0.0.1`에만 bind합니다.
- Local Agent는 허용된 GS Dashboard Origin만 CORS로 허용합니다.
- Campaign 반영은 중앙 서버가 발급한 단기 one-time Sync Token이 있어야 가능합니다.
- 동일 Campaign 재반영은 새 Campaign이 아니라 새 Revision을 만들고 최신 Revision을 Active로 지정합니다.
- 동일 역할 파일이 여러 개면 Header Signature로 역할을 분류한 뒤 `modifiedAt` 기준 최신 파일을 선택합니다.
- Revision 생성 여부는 선택된 전체 역할별 파일의 content SHA-256만 비교합니다. 같은 내용의 파일명 또는 수정시각 변경은 `UNCHANGED`로 처리합니다.
