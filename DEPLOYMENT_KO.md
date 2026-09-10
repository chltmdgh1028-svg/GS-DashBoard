# 중앙 운영형 배포 방법

이 앱은 ADMIN이 Local Agent로 Campaign Snapshot을 반영하고, OFC가 로그인 후 본인 담당 권역만 조회하는 중앙 운영형 웹앱입니다. 권한 제한을 서버에서 수행해야 하므로 `index.html`만 정적 배포하는 방식은 사용하지 않습니다.

## 실행 구조

- ADMIN Web: 중앙 서버 로그인 후 Local Agent 연결, 폴더 자료 확인, Campaign 반영
- Local Agent: 관리자 PC의 지정 로컬 폴더를 직접 읽고 Excel 분석, Store Alias, KPI 계산, 검증 수행, gzip Snapshot 생성
- ADMIN Browser: Local Agent에서 받은 gzip Snapshot을 현재 로그인 세션으로 중앙 same-origin API에 전송
- Central Server: ADMIN 세션과 one-time Sync Token을 확인한 뒤 Snapshot을 Campaign Revision으로 저장
- OFC: 로그인 후 서버가 허용한 Dashboard 데이터만 조회

중앙 Vercel 서버는 관리자 PC의 로컬 폴더에 접근하지 않습니다. 폴더 경로는 각 PC의 Local Agent 설정 파일에만 저장합니다. 회사 PC에서 Node standalone HTTPS가 Proxy/TLS 정책과 충돌할 수 있으므로, 중앙 반영 전송은 ADMIN 브라우저가 수행합니다.

## 사내 서버 실행

Node.js 20 이상이 설치된 사내 서버에서 중앙 웹 서버를 실행합니다.

```powershell
npm install
$env:ADMIN_ID="admin"
$env:ADMIN_PASSWORD="admin"
$env:DATA_DIR="D:\GS-DashBoard\data"
$env:PORT="8080"
npm start
```

접속 URL 예:

```text
http://서버IP:8080/
```

운영에서는 IIS, Nginx, Apache 같은 Reverse Proxy 앞에 두고 HTTPS를 적용하는 것을 권장합니다.

## Local Agent 실행

관리자 PC에서 별도 터미널로 실행합니다.

```powershell
$env:LOCAL_INPUT_DIR="C:\GS-Dashboard\Input"
$env:CENTRAL_ORIGIN="https://gs-dash-board.vercel.app,http://localhost:8080"
$env:AGENT_PORT="8787"
npm run agent
```

테스트 배포용 Windows 실행파일은 아래 명령으로 생성합니다.

```powershell
npm run package:agent
```

생성 파일은 `dist-agent\GS-Dashboard-Agent.exe`입니다. 관리자 PC에서는 Node.js/npm 없이 이 파일을 더블클릭해 실행할 수 있습니다.

ADMIN 화면의 `[폴더 선택]` 버튼은 Local Agent를 통해 Windows 폴더 선택 창을 열고 선택 경로를 PC별 Agent 설정으로 저장합니다. 직접 경로를 입력해 저장할 수도 있습니다. 저장 위치는 기본적으로 `%LOCALAPPDATA%\GS-Dashboard-Agent\config.json`입니다.

## 파일 선택 규칙

- 폴더 내 Excel 파일을 Header Signature로 자동 분류합니다.
- 동일 역할 파일이 여러 개 있으면 가장 최신 `modifiedAt` 파일만 사용합니다.
- 선택된 파일은 `sha256 hash`로 마지막 반영 이후 변경 여부를 판단합니다.
- 같은 내용의 파일명 변경 또는 `modifiedAt` 변경은 `UNCHANGED`로 처리합니다.
- Excel 실제 내용이 변경되거나, 동일 역할의 더 최신 파일이 선택되면서 content hash가 바뀌면 새 Revision을 만듭니다.
- 폴더에 파일이 생겼다고 자동 공개하지 않습니다. ADMIN이 `Campaign 반영`을 클릭해야 Active Revision이 바뀝니다.

## 저장소

현재 MVP는 `DATA_DIR` 아래 JSON 파일에 Campaign Revision과 OFC 계정을 저장합니다. 운영 확장 시 이 계층만 PostgreSQL, SQL Server, D1 등 DB로 교체하면 됩니다.

## 계정

테스트 기본 ADMIN 계정은 `admin / admin`입니다. ADMIN이 Campaign을 반영하면 조직도 기준 OFC 목록으로 OFC 계정이 자동 생성됩니다. 테스트 기본 OFC 계정은 `본인이름 / 본인이름`입니다.
