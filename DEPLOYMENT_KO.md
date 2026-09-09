# 중앙 운영형 배포 방법

이 앱은 ADMIN이 원시 Excel을 업로드하고, OFC가 로그인 후 본인 담당 권역만 조회하는 중앙 운영형 웹앱입니다.
권한 제한을 서버에서 수행해야 하므로 `index.html`만 정적 배포하는 방식은 사용하지 않습니다.

## 실행 구조

- ADMIN: 원시 Excel 업로드 또는 Excel 범위 붙여넣기로 Campaign Snapshot 생성
- 서버: Excel 분석, Store Alias, KPI 계산, 검증, Snapshot 저장
- OFC: 로그인 후 서버가 허용한 Dashboard 데이터만 조회

OFC 응답에는 다른 OFC 점포 상세, Raw fact, 중간 가공 fact, 검증 리포트가 포함되지 않습니다.

## 사내 서버 실행

Node.js 20 이상이 설치된 사내 서버에서 실행합니다.

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

## 저장소

현재 MVP는 `DATA_DIR` 아래 JSON 파일에 Campaign Snapshot과 OFC 계정을 저장합니다.
운영 확장 시 이 계층만 PostgreSQL, SQL Server, D1 등 DB로 교체하면 됩니다.

## 계정

테스트 기본 ADMIN 계정은 `admin / admin`입니다.
ADMIN이 Campaign을 생성하면 조직도 기준 OFC 목록으로 OFC 계정이 자동 생성됩니다.
테스트 기본 OFC 계정은 `본인이름 / 본인이름`입니다.
