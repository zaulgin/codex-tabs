# Stage 1 — дополнение к официальному Codex

Version: 1
Spec ref/version: `codex-tabs_spec.md`, v1.

Goal: проверяемый устанавливаемый прототип N официальных вкладок и выбора общей истории.

In scope: extension manifest/commands, URI adapter, QuickPick истории, ограниченный read-only App Server client, тесты, документация, VSIX.

Out of scope: собственный webview/chat engine, изменение official bundle, установка, публикация, commit/push.

Dependencies: установленный official Codex; VS Code desktop Remote SSH; доступный `codex` executable. Для synthetic tests — Node built-ins, без реального аккаунта/истории/LLM.

Touched areas: новый `src/`, `test/`, `scripts/`, `package.json`, `.gitignore`, `.vscodeignore`, `.vscode/launch.json`, README. Baseline: clean main, существующий README из 12 байт.

Steps:
1. Зафиксировать тесты URI (уникальные новые и стабильные существующие), валидации ID и RPC (handshake, пагинация, ошибки, отмена, завершение).
2. Реализовать adapter и client, минимальный native QuickPick без собственного чата. История — только данные, без открытия/возобновления сессии до выбора пользователя.
3. Проверить совместимость official custom-editor contribution до открытия; активировать официальное расширение; использовать `preview:false`.
4. Добавить упаковку VSIX и README с честной границей synthetic/runtime evidence.
5. Выполнить focused/full suite нового проекта, packaging inspection и независимое review. Исправить findings, повторить затронутые проверки.
6. Если доступен изолированный VS Code host — проверить загрузку дополнения там. Полноценный Windows→SSH сценарий не заменять моками.

Acceptance: критерии спецификации 1–5; без пункта 5 не заявлять полный функциональный паритет.

Checks: Node tests с реальными stream/process fixtures, проверки пакета, diff check; ручная проверка N сессий и Windows clipboard отдельно и явно отмечается как выполненная или нет.

Reviewer focus: неизменность официального расширения; URI — не произвольный route/command; корректная маршрутизация ID; lifecycle дочернего процесса; отсутствие утечек; гарантии тестов не преувеличены.

Permissions needed: обычные локальные правки и проверки входят в реализацию, запрошенную пользователем. Сетевые установки/запуски в окружении при sandbox restriction — через штатный approval. Реальную историю/credentials не читать. Установка в пользовательский VS Code, GitHub, commit/push не разрешены этим планом.

Stop and ask if: официальный UI требует изменения установленного bundle или при проверке не обеспечивает независимые разговоры; меняется способ хранения истории; нужны действия в реальных чатах или пользовательском VS Code.
