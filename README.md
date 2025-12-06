<p align="center">
  <img src="src/assets/icon@2.png" alt="SimpleProjector Logo" width="200">
</p>

## SimpleProjector

SimpleProjector is a cross‑platform desktop app built with Electron and React to make **projection simple, elegant, and reliable**. It is designed for ads, work presentations, classrooms, events, and any situation where you need to put content on a screen without fighting the tooling.

### Vision

- **Simplicity first**: Focus on your content, not on configuring complex slides or playlists.
- **Elegant by default**: Clean, distraction‑free projection with a modern UI.
- **Versatile use cases**: From digital signage and ads to quick work demos and talks.
- **Open‑source spirit**: Transparent code, community‑friendly, and easy to extend.

### Core Features

- **Drag & drop projection**
  - Drop images, PDFs, and other supported files into the app to prepare them for projection.
  - Quickly reorder or remove items before presenting.

- **Projector view**
  - A dedicated, borderless window optimized for external displays or projectors.
  - Shows only the selected content so your main screen can stay private.

- **File management**
  - Thumbnail previews of your content for quick identification.
  - Simple list of files that you can navigate and select for projection.

- **Import / export**
  - Save your current playlist or setup so you can reuse it later or share it with another machine.
  - Import existing configurations to get a full projection layout ready in seconds.

- **PDF support**
  - Uses `pdfjs-dist` to render PDF pages cleanly.
  - Navigate pages smoothly for reports, documents, or print‑style layouts.

- **App settings**
  - Basic configuration for behavior and appearance (depending on your current build).
  - Designed so more options can be added without complicating the UI.

### Architecture & Design Principles

- **Electron + React + TypeScript**
  - Electron powers the desktop shell on Windows, macOS, and Linux.
  - React and TypeScript provide a robust, type‑safe renderer UI.

- **Clean Architecture & SOLID‑oriented**
  - UI components in `src/components` stay focused on presentation and interaction.
  - Domain concepts (like files, settings, and projector behavior) are modeled in `src/types` and `src/lib`.
  - Logic is structured to be testable and replaceable, keeping infrastructure details (Electron APIs, file system, etc.) at the edges.

### Getting Started (Development)

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Run in development**

   ```bash
   npm start
   ```

3. **Build distributables**

   ```bash
   npm run make
   ```

Packages are created under the `out` directory for each supported platform.

### Contributing

- **Issues & ideas**: Propose improvements such as new file types, scheduling for ads, or better projector controls.
- **Code style**: Follow the existing TypeScript/React patterns and keep modules small and focused.
- **Architecture**: Respect the separation between UI, domain logic, and infrastructure to keep the project maintainable.

### License

This project is released under the **MIT License**, as defined in `package.json`. You are free to use, modify, and distribute it, subject to the terms of that license.
