# 🚀 QuickTrigger

### 권한 기반의 스마트 링크 대시보드

QuickTrigger는 개인이나 조직이 수많은 웹 사이트 링크를 효율적으로 관리하고 공유할 수 있도록 설계된 **심플하면서도 강력한 대시보드 솔루션**입니다. 드래그 앤 드롭 형태의 자유로운 편집과 정교한 권한 관리를 통해 최적의 워크플로우를 제공합니다.

---

## ✨ 주요 기능

- **실시간 드래그 앤 드롭**: 링크와 카테고리를 자유롭게 배치하고 즉시 저장합니다.
- **정교한 권한 시스템**: `Admin`, `Manager`, `User` 권한 분리 기능을 제공합니다.
- **스마트 편집 모드**: 모드 전환을 통해 읽기 전용과 편집 상태를 명확히 구분합니다.
- **강력한 Undo/Redo**: 최대 30단계의 작업 히스토리를 지원하여 안심하고 편집할 수 있습니다.
- **반응형 디자인**: PC와 태블릿 환경에서 최적의 사용성을 유지합니다.
- **보안 중심 설계**: HttpOnly Cookie 기반의 JWT 인증으로 보안성을 강화했습니다.

---

## 🛠 기술 스택

### Frontend
- **Framework**: React (Vite)
- **State Management**: Zustand
- **UI & Layout**: Tailwind CSS, Lucide React
- **Interaction**: @dnd-kit/core

### Backend
- **Runtime**: Node.js (Express)
- **Language**: TypeScript
- **Database**: SQLite (via Prisma)
- **Authentication**: JWT, bcryptjs

---

## 📦 설치 및 시작하기

### 1. 사전 요구사항
- **Node.js**: v18.18.0 이상

### 2. 설치
```bash
git clone https://github.com/godwish/QuickTrigger.git
cd QuickTrigger
npm install
```

### 3. 환경 설정
`.env.example` 파일을 복사하여 `.env` 파일을 생성하고 필요한 값을 설정합니다.
```bash
cp .env.example .env
```

### 4. 프로젝트 실행 및 초기 설정
```bash
# 서버 실행 (Frontend + Backend)
npm run dev
```

서버가 실행되면 브라우저에서 `http://localhost:5173`에 접속합니다. **웹 인스톨러**가 자동으로 실행되어 데이터베이스 및 관리자 설정을 안내합니다.

---

## 🐳 Docker로 실행하기

Docker를 사용하면 별도의 환경 설정 없이 간편하게 프로젝트를 실행할 수 있습니다.

### 1. Docker Compose로 실행
```bash
# 이미지 빌드 및 컨테이너 실행
docker-compose up --build -d
```

### 2. 환경 변수 설정
`docker-compose.yml` 파일의 `environment` 섹션에서 직접 설정하거나, `.env` 파일을 작성하여 주입할 수 있습니다.

### 3. 데이터 보관
SQLite 데이터베이스 파일은 호스트의 `./.runtime` 디렉토리에 저장되어 컨테이너를 재시작해도 데이터가 유지됩니다.

---

## 🛠 상세 설정 및 CLI 도구

웹 인스톨러 대신 터미널에서 직접 초기화하거나 샘플 데이터를 넣고 싶을 때 사용합니다.

### 데이터베이스 수동 초기화
```bash
# Prisma Client 생성
npm run db:generate

# DB 스키마 강제 반영
npm run db:push

# 초기 관리자 생성 및 샘플 데이터 시딩
# (.env의 INITIAL_ADMIN_USERNAME, SEED_SAMPLE_DATA 설정 참조)
npm run db:seed
```

## 🚀 빌드 및 운영

운영 환경을 위해 프로젝트를 빌드하고 실행하는 방법입니다.

```bash
# 프로젝트 빌드
npm run build

# 서버 실행
npm start
```
*프론트엔드 결과물은 `dist/web`에, 서버는 `dist/server`에 위치하며 서버가 통합 서빙합니다.*

---

## 📂 프로젝트 구조

```text
.
├── apps
│   ├── server        # Express API 서버 (TypeScript)
│   └── web           # Vite + React 프론트엔드
├── prisma            # Prisma Schema 및 Migration
└── dist              # 빌드 결과물 (Production)
```

---

## 📄 라이선스
이 프로젝트는 MIT 라이선스 하에 배포됩니다.
