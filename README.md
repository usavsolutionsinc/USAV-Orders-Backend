# Antigravity Warehouse

This project was manually scaffolded because `npx` was unavailable in the environment.

## Setup Instructions

1.  **Install Dependencies**:
    Open your terminal, navigate to this directory, and run:
    ```bash
    npm install
    ```
    (Or `yarn install` / `pnpm install` / `bun install`)

2.  **Configure QZ Tray**:
    -   Install QZ Tray on your machine.
    -   Generate a certificate and private key.
    -   Update `.env.local` with your certificate and key.

3.  **Run the App**:
    ```bash
    npm run dev
    ```

4.  **Open in Browser**:
    Go to `http://localhost:3000`.

## Features
-   **Dashboard**: View orders in a "Google Antigravity" style interface.
-   **Printing**: Click "Print Docs + Label" to silently print packing slips and labels via QZ Tray.
-   **API**: Mock API routes for orders and printing status.
