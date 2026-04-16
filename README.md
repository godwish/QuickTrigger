<img width="1368" height="1067" alt="Image" src="https://github.com/user-attachments/assets/21319d4c-3e6f-4513-bfe1-52f08844a583" />

<img width="1366" height="1307" alt="Image" src="https://github.com/user-attachments/assets/e980baac-8ced-453b-934e-b0ce5f291adb" />

<img width="1586" height="817" alt="Image" src="https://github.com/user-attachments/assets/246e6e3e-b2b0-4675-bd70-e92d8d91275b" />

---

# 🚀 QuickTrigger

### A Click-Based Smart Link Dashboard You Can Use Instantly — No Complex Setup Required

QuickTrigger is a **simple yet powerful dashboard solution** designed to help individuals and teams efficiently manage and share large numbers of web links. With flexible drag-and-drop editing and a refined permission system, it provides an optimized workflow—allowing you to launch a fully functional dashboard immediately after installation.

---

## ✨ Key Features

* **Zero-Touch Installer**: Complete installation in just a few clicks via the web—no need for environment variables (`.env`) or database knowledge.
* **Real-Time Drag & Drop**: Freely arrange links and categories with instant saving.
* **Advanced Permission System**: Supports role-based access control with `Admin`, `Manager`, and `User`.
* **Smart Edit Mode**: Clearly distinguish between read-only and edit states through mode switching.
* **Powerful Undo/Redo**: Safely edit with up to 30 levels of history support.
* **Auto-Generated Sample Data**: Useful example links are automatically created upon installation.
* **Security-First Design**: Uses HttpOnly cookie-based JWT authentication with automatically generated security keys.

---

## 🛠 Tech Stack

### Frontend

* **Framework**: React (Vite)
* **State Management**: Zustand
* **UI & Layout**: Tailwind CSS, Lucide React
* **Interaction**: @dnd-kit/core

### Backend

* **Runtime**: Node.js (Express)
* **Language**: TypeScript
* **Database**: SQLite (via Prisma) — file-based DB with no separate server required
* **Authentication**: JWT, bcryptjs

---

## 📦 Installation & Getting Started

QuickTrigger requires no complicated pre-configuration.

### 1. Prerequisites

* **Node.js**: v18.18.0 or higher

### 2. Installation

```bash
git clone https://github.com/godwish/QuickTrigger.git
cd QuickTrigger
npm install
```

### 3. Run & Initial Setup

```bash
# Build and run the entire project
npm run build
npm start
```

Once the server is running, open `http://localhost:4000` in your browser.
The **one-touch web installer** will launch automatically—just enter your site name and admin details, and your dashboard will be ready instantly.

---

## 🐳 Run with Docker

Using Docker is the fastest way to get started without additional setup. You can either use a pre-built image or build one yourself.

### Method 1: Run from Docker Hub (Recommended)

Use the latest pre-built image for instant deployment.
👉 **[Go to Docker Hub Repository](https://hub.docker.com/r/koseungmin/quick-trigger)**

1. Create a `docker-compose.yml` file:

```yaml
services:
  quick-trigger:
    image: koseungmin/quick-trigger:latest
    container_name: quick-trigger
    restart: always
    ports:
      - "4000:4000"
    volumes:
      - ./.runtime:/app/.runtime
```

2. Start the service:

```bash
docker-compose up -d
```

### Method 2: Build and Run Manually

Use this if you want to modify the source code or build your own image.

1. Build the image:

```bash
docker build -t quick-trigger:latest .
```

2. Run the service:

```bash
docker-compose up -d
```

*(Note: The `image` field in docker-compose.yml should be set to `quick-trigger:latest`.)*

### 📦 Data Storage & Management

All data (settings, security keys, database) is stored in the host's `./.runtime` directory.
With volume mounting, your data remains safe even if the container restarts or the image is updated.

---

## 🚀 Build & Production

For running in a production environment:

```bash
# Build the project
npm run build

# Start the server
npm start
```

---

## 📂 Project Structure

```text
.
├── apps
│   ├── server        # Express API server (TypeScript)
│   └── web           # Vite + React frontend
├── prisma            # Prisma schema
├── .runtime          # SQLite DB & session key storage (do not delete)
└── dist              # Build output (Production)
```

---

## 📄 License

This project is distributed under the MIT License.

---

# 🚀 QuickTrigger

### 복잡한 설정 없이 즉시 사용하는 클릭 기반 스마트 링크 대시보드

QuickTrigger는 개인이나 조직이 수많은 웹 사이트 링크를 효율적으로 관리하고 공유할 수 있도록 설계된 **심플하면서도 강력한 대시보드 솔루션**입니다. 드래그 앤 드롭 형태의 자유로운 편집과 정교한 권한 관리를 통해 최적의 워크플로우를 제공하며, 설치 즉시 바로 전용 대시보드를 구축할 수 있습니다.

---

## ✨ 주요 기능

- **Zero-Touch 인스톨러**: 환경 변수(`.env`) 설정이나 데이터베이스 지식 없이도 웹에서 클릭 몇 번으로 설치가 완료됩니다.
- **실시간 드래그 앤 드롭**: 링크와 카테고리를 자유롭게 배치하고 즉시 저장합니다.
- **정교한 권한 시스템**: `Admin`, `Manager`, `User` 권한 분리 기능을 제공합니다.
- **스마트 편집 모드**: 모드 전환을 통해 읽기 전용과 편집 상태를 명확히 구분합니다.
- **강력한 Undo/Redo**: 최대 30단계의 작업 히스토리를 지원하여 안심하고 편집할 수 있습니다.
- **자동 시료(Sample) 데이터**: 설치 완료 시 즉시 사용할 수 있는 유용한 링크 예제들이 자동으로 생성됩니다.
- **보안 중심 설계**: HttpOnly Cookie 기반의 JWT 인증으로 보안성을 강화했으며, 보안 키가 자동으로 생성됩니다.

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
- **Database**: SQLite (via Prisma) - 별도의 서버 설정이 필요 없는 파일형 DB
- **Authentication**: JWT, bcryptjs

---

## 📦 설치 및 시작하기

QuickTrigger는 별도의 복잡한 사전 설정이 필요하지 않습니다.

### 1. 사전 요구사항
- **Node.js**: v18.18.0 이상

### 2. 설치
```bash
git clone https://github.com/godwish/QuickTrigger.git
cd QuickTrigger
npm install
```

### 3. 프로젝트 실행 및 초기 설정
```bash
# 전체 프로젝트 빌드 및 실행
npm run build
npm start
```

서버가 실행되면 브라우저에서 `http://localhost:4000`에 접속합니다. **원터치 웹 인스톨러**가 자동으로 실행되며, 사이트 이름과 관리자 정보만 입력하면 즉시 대시보드가 활성화됩니다.

---

## 🐳 Docker로 실행하기

Docker를 사용하면 별도의 환경 설정 없이 가장 빠르게 QuickTrigger를 시작할 수 있습니다. 이미 빌드되어 배포된 이미지를 사용하거나, 직접 이미지를 빌드하여 실행할 수 있습니다.

### 방법 1: Docker Hub에서 내려받아 실행하기 (권장)
이미 빌드된 최신 이미지를 사용하여 즉시 실행합니다.  
👉 **[Docker Hub 저장소 바로가기](https://hub.docker.com/r/koseungmin/quick-trigger)**

1. `docker-compose.yml` 파일을 작성합니다:
```yaml
services:
  quick-trigger:
    image: koseungmin/quick-trigger:latest
    container_name: quick-trigger
    restart: always
    ports:
      - "4000:4000"
    volumes:
      - ./.runtime:/app/.runtime
```

2. 서비스를 실행합니다:
```bash
docker-compose up -d
```

### 방법 2: 직접 빌드하여 실행하기
소스 코드를 수정하거나 직접 이미지를 생성하고 싶을 때 사용합니다.

1. 이미지를 빌드합니다:
```bash
docker build -t quick-trigger:latest .
```

2. 서비스를 실행합니다:
```bash
docker-compose up -d
```
*(참고: docker-compose.yml의 image 항목이 `quick-trigger:latest`로 되어 있어야 합니다.)*

### 📦 데이터 보관 및 관리
모든 데이터(설정, 보안 키, 데이터베이스)는 호스트의 `./.runtime` 디렉토리에 저장됩니다. 볼륨 마운트 설정을 통해 컨테이너를 재시작하거나 이미지를 업데이트해도 데이터가 안전하게 유지됩니다.

---

## 🚀 빌드 및 운영

운영 환경을 위해 프로젝트를 빌드하고 실행하는 방법입니다.

```bash
# 프로젝트 빌드
npm run build

# 서버 실행
npm start
```

---

## 📂 프로젝트 구조

```text
.
├── apps
│   ├── server        # Express API 서버 (TypeScript)
│   └── web           # Vite + React 프론트엔드
├── prisma            # Prisma Schema
├── .runtime          # SQLite DB 및 세션 키 저장소 (무단 삭제 주의)
└── dist              # 빌드 결과물 (Production)
```

---

## 📄 라이선스
이 프로젝트는 MIT 라이선스 하에 배포됩니다.
