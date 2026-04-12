@echo off
cd /d "C:\Users\hriti\OneDrive\Documents\GitHub\ChatBotImplementation\backend"
start "ChatBot Server" node src/server.js
timeout /t 2 /nobreak >nul
start http://localhost:3000/widget/embed-example.html
