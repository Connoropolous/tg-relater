# tg-relater


Copy .env-example to `.env`

Message BotFather on telegram to create a bot token

Allow the bot to access group messages
https://stackoverflow.com/questions/50204633/allow-bot-to-access-telegram-group-messages

Set the `TELEGRAM_BOT_TOKEN` value of `.env` file to your real bot token.

Run

`npm install`

Then

`npm run start`

Or, if you want auto-restarting on code changes

`npm run start-watch`


Create a group on telegram, invite your bot to that group.

Run `/run` to initiate a game

Type and send 'me' to join the game

Run `/ready` to launch the game

Use DMs with the bot to play the game

Run `/end` to early end the game
