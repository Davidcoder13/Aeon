### Contributing to Aeon

Thank you for your interest in contributing to Aeon! Projects like this thrive on community feedback, bug reports, and code contributions. 

Please take a moment to review this document before submitting issues or pulling requests. 

### How to Contribute

### 1. Reporting Bugs

If you find a bug, please check the existing Issues tab to ensure it hasn't already been reported. If it is new, open an issue and include: 

* A clear, descriptive title.
* Steps to reproduce the behavior (including specific chess moves or FEN strings if applicable).
* Expected vs. actual behavior.
* Your browser and operating system details.

### 2. Suggesting Enhancements

Have an idea to make the engine stronger or the web page more responsive? Open an issue and label it as an "enhancement." Describe the feature, why it would be useful, and any implementation ideas you have. 

### 3. Submitting Code Changes (Pull Requests)

We welcome pull requests for bug fixes, performance optimizations, and UI improvements. To contribute code: 

1. Fork the repository and create your branch from main.
2. Ensure your local environment is set up correctly (see the Build instructions in the README).
3. Make your changes. If you are modifying the core engine code, ensure it still compiles successfully via Emscripten.
4. Test your changes locally using the static server script.
5. Commit your changes with clear, descriptive commit messages.
6. Push to your fork and submit a Pull Request to our main branch.

### Development Workflow

Aeon relies on a specific structure to bridge C++ and the browser: 

* Core engine calculations (move generation, search, NNUE evaluation) live in the C++ files and compile down to WebAssembly.
* The web worker (engine-worker.js) handles asynchronous communication so the main UI thread never freezes.
* The frontend uses cm-chessboard for visual rendering.

Please ensure any structural changes respect this separation of concerns to keep the engine fast and portable. 

### Code of Conduct

By participating in this project, you agree to keep communication respectful, constructive, and inclusive for everyone.
