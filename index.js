import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import express from "express";
import { sub } from "date-fns";

import { prisma } from "./config/prisma.js";
import { checkWin, createGame, isDraw, main, saveUser, updateBoard, updateOpponentBoard } from "./utils/index.js";

dotenv.config();

const token = process.env.token;
const bot = new Telegraf(token);
const app = express();

app.use(await bot.createWebhook({ domain: process.env.webhookDomain, drop_pending_updates: true }));

app.get("/", async (req, res) => {
    res.send("Bot Started");
})

app.get("/clear", async (req, res) => {
    const oneWeekAgo = sub(new Date(), { days: 2 });

    const unUsedGames = await prisma.game.findMany({
        where: {
            creationDate: {
                lte: oneWeekAgo
            },
            status: "ONGOING"
        },
        take: 20
    })

    for (let game of unUsedGames) {
        try {
            await prisma.game.delete({
                where: {
                    id: game.id
                }
            })

            if (game.type === "CHILL") {
                await bot.telegram.editMessageText(game.creatorId, game.creatorMessageId, undefined, "Game canceled...");
                return;
            }

            if (game.type === "BATTLE") {
                await bot.telegram.editMessageText(game.creatorId, game.creatorMessageId, undefined, "Game canceled...");
                await bot.telegram.editMessageText(game.otherUserId, game.otherUserMessageId, undefined, "Game canceled...");

                return;
            }
        } catch (error) {
            console.log(error)
        }
    }

    res.sendStatus(200)
})

bot.start(async (ctx) => {
    const payload = ctx.payload;

    await saveUser(ctx);

    if (payload.toLowerCase().includes("battle")) {
        const battleId = payload.substring(6);

        const battle = await prisma.game.findFirst({
            where: {
                id: battleId
            }
        })

        if (!battle) {
            await ctx.reply("Battle doesn't exist. \n\nSend /battle to start a new battle.");

            return;
        }

        if (battle.creatorId == ctx.from.id) {
            await ctx.reply("You can't play with yourself... Lol\n\nSend /tictactoe to start a game with a computer (with a heart 🤪)");

            return;
        }


        if (battle.otherUserId) {
            await ctx.reply("The battle has already started...");

            return;
        }

        await prisma.game.update({
            where: {
                id: battleId
            },
            data: {
                otherUserId: ctx.from.id.toString(),
                userTurnId: ctx.from.id.toString()
            }
        })

        const user = await prisma.users.findFirst({
            where: {
                userID: battle.creatorId
            }
        })

        await ctx.reply(`${user.firstName} invited you to a battle.\n\nBattle started !!`);
        const otherUserMsg = await ctx.reply("Tap on a Box to place a sign:\n\nYour Turn (X)", {
            reply_markup: {
                inline_keyboard: [
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 1}` })),
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 4}` })),
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 7}` }))
                ]
            }
        })

        await ctx.telegram.sendMessage(battle.creatorId, `${ctx.from.first_name} accepted your invitation.\n\nBattle started !!`);
        const creatorMsg = await ctx.telegram.sendMessage(battle.creatorId, `Tap on a Box to place a sign:\n\n${ctx.from.first_name}'s Turn (X)`, {
            reply_markup: {
                inline_keyboard: [
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 1}` })),
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 4}` })),
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 7}` }))
                ]
            }
        })

        await prisma.game.update({
            where: {
                id: battleId
            }, data: {
                creatorMessageId: creatorMsg.message_id.toString(),
                otherUserMessageId: otherUserMsg.message_id.toString()
            }
        })

        return;
    }

    await ctx.reply("Play Tic-Tac-Toe on Telegram\n\n Send /tictacteo to start a new game", {
        parse_mode: "HTML"
    });
})

bot.command("tictacteo", async (ctx) => {
    const battleId = await createGame("CHILL", ctx.from.id.toString());

    const msg = await ctx.reply("Tap on a Box to place a sign:\n\nYour Turn (X)", {
        reply_markup: {
            inline_keyboard: [
                [...Array(3)].map((_, index) => ({ text: " ", callback_data: `play_${battleId}_${index + 1}` })),
                [...Array(3)].map((_, index) => ({ text: " ", callback_data: `play_${battleId}_${index + 4}` })),
                [...Array(3)].map((_, index) => ({ text: " ", callback_data: `play_${battleId}_${index + 7}` }))
            ]
        }
    })

    await prisma.game.update({
        where: {
            id: battleId
        }, data: {
            creatorMessageId: msg.message_id.toString()
        }
    })
})

bot.command("battle", async (ctx) => {
    await saveUser(ctx);

    const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

    if (isGroup) {
        const oppentId = ctx.message?.reply_to_message?.from.id;

        if (!oppentId) return;
        if (ctx.message.reply_to_message.from.is_bot) return;

        const userName = ctx.from.first_name;
        const oppentName = ctx.message.reply_to_message.from?.first_name;

        const battleId = await createGame("GROUPBATTLE", ctx.from.id.toString(), oppentId.toString());

        const battleMsg = await ctx.reply(`<b>Battle: ${userName} vs ${oppentName}</b>\n\nTap on a Box to place a sign:\n\n${oppentName}'s Turn (X)`, {
            reply_markup: {
                inline_keyboard: [
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `groupbattle_${battleId}_${index + 1}` })),
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `groupbattle_${battleId}_${index + 4}` })),
                    [...Array(3)].map((_, index) => ({ text: " ", callback_data: `groupbattle_${battleId}_${index + 7}` }))
                ]
            },
            parse_mode: "HTML"
        })

        await prisma.game.update({
            where: {
                id: battleId
            }, data: {
                creatorMessageId: battleMsg.message_id.toString()
            }
        })

        return;
    }

    const battleId = await createGame("BATTLE", ctx.from.id.toString());

    await ctx.reply(`Game created. Send this link to your friend to start the battle\n\n➡ https://t.me/${ctx.botInfo.username}?start=battle${battleId}`)
})

bot.command("stats", async (ctx) => {
    const user = await prisma.users.findFirst({
        where: {
            userID: ctx.from.id.toString()
        }
    })

    const totalMatches = user.matchWon + user.matchLost + user.matchDraw;
    const totalBattles = user.battleWon + user.battleLost + user.battleDraw;

    await ctx.reply(`<b>🎉 Achievements 🎉</b>\n\n<b>👉 Total Matches Played: 🏅</b> <i>${totalMatches}</i>\n<b>👉 Wins:🏆</b> ${user.matchWon}\n<b>👉 Losses: 😞</b> ${user.matchLost}\n<b>👉 Draws: 🤝</b> ${user.matchDraw}\n\n<b>✨ Telegram Battles ✨</b>\n\n<b>👉 Total Battle Played: 🌟</b> ${totalBattles}\n<b>👉 Battles Wins: 🥇</b> ${user.battleWon}\n<b>👉 Battle Losses: 🥈</b> ${user.battleLost}\n<b> 👉 Battle Draws: 🥉</b> ${user.battleDraw}`, {
        parse_mode: "HTML"
    });
})

bot.command("broadcast", async (ctx) => {
    if (ctx.from.id != process.env.OWNER) return;

    const firstUser = await prisma.users.findFirst();

    await prisma.broadcast.update({
        where: {
            id: process.env.broadcast_id
        },
        data: {
            status: "running"
        }
    })

    const out = await ctx.reply("Broadcast Started! You will be notified with log file when all the users are notified.", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Cancel", callback_data: "cancel" }]
            ]
        }
    });
    const startTime = Date.now();

    await main(firstUser.userID, 0, 0, 0, out.message_id, startTime, {
        chatId: ctx.from.id,
        message_id: ctx.message.reply_to_message.message_id
    }, ctx)

    // await ctx.replyWithDocument({ source: 'broadcast.txt', filename: 'broadcast.txt' }, { caption: `Broadcast completed in ${completedIn}\n\nTotal users ${totalUsers}.\nTotal done ${done}, ${success} success and ${failed} failed.`, parse_mode: 'Markdown' }); }
})

bot.on("callback_query", async (ctx) => {
    const callback_data = ctx.callbackQuery.data;
    const [command, battleId, position] = callback_data.split("_");
    let boards = [];

    if (command === "play") {
        const game = await prisma.game.findFirst({
            where: {
                id: battleId
            },
            select: {
                userTurnId: true,
                creatorId: true
            }
        })

        if (!game) {
            await ctx.editMessageText("Something went wrong... Start a new game.");

            return;
        }

        if (game.creatorId != ctx.from.id) {
            await ctx.answerCbQuery("❌❌ This is not your game. Send /tictacteo to start a new game", {
                show_alert: true
            });

            return
        }

        if (game.userTurnId != ctx.from.id) {
            await ctx.answerCbQuery("Wait for your turn...");

            return
        }

        boards = await updateBoard(position, "X", battleId, "CHILL", undefined, ctx);

        if (checkWin(boards, "X")) {
            await ctx.answerCbQuery("You Won...", {
                show_alert: true
            });

            await prisma.game.delete({
                where: {
                    id: battleId
                }
            })

            await ctx.editMessageText("You Won...");

            await prisma.users.update({
                where: {
                    userID: ctx.from.id.toString()
                },
                data: {
                    matchWon: {
                        increment: 1
                    }
                }
            })

            return;
        }

        await prisma.game.update({
            where: {
                id: battleId
            },
            data: {
                userTurnId: ""
            }
        })

        const availableBoardPos = await prisma.board.findMany({
            where: {
                gameId: battleId,
                sign: ""
            },
            select: {
                position: true
            }
        })

        // const allBoards = await prisma.board.findMany({
        //     where: {
        //         gameId: battleId
        //     },
        //     select: {
        //         sign: true
        //     }
        // })


        // const bestMove = minimax(allBoards, 0, true, 1000); // Adjust maxDepth as needed

        // console.log("BestMove", bestMove);

        const randIndex = Math.floor(Math.random() * availableBoardPos.length)
        const computerPos = availableBoardPos[randIndex];

        if (!computerPos) {
            await ctx.editMessageText("Game Over... The game is tie");

            await prisma.users.update({
                where: {
                    userID: ctx.from.id.toString()
                },
                data: {
                    matchDraw: {
                        increment: 1
                    }
                }
            })

            return
        }

        await ctx.answerCbQuery("Computer is thinking...")

        await new Promise(resolve => setTimeout(resolve, 1000));

        boards = await updateBoard(computerPos.position, "O", battleId, "CHILL", undefined, ctx);

        if (checkWin(boards, "O")) {
            await prisma.game.delete({
                where: {
                    id: battleId
                }
            })

            await ctx.editMessageText("You Loose... A machine crunch you 😂😂");

            await prisma.users.update({
                where: {
                    userID: ctx.from.id.toString()
                },
                data: {
                    matchLost: {
                        increment: 1
                    }
                }
            })

            return;
        }

        await prisma.game.update({
            where: {
                id: battleId
            },
            data: {
                userTurnId: ctx.from.id.toString()
            }
        })
    }

    if (command === "playbattle") {
        const game = await prisma.game.findFirst({
            where: {
                id: battleId
            },
            select: {
                userTurnId: true,
                creatorId: true,
                otherUserId: true,
                creatorMessageId: true,
                otherUserMessageId: true
            }
        })

        if (!game) {
            await ctx.editMessageText("Something went wrong... Start a new game.");

            return;
        }

        const player = game.userTurnId === game.creatorId ? "O" : "X";
        const otherPlayerId = game.userTurnId === game.creatorId ? game.otherUserId : game.creatorId
        const messageId = game.userTurnId === game.creatorId ? game.otherUserMessageId : game.creatorMessageId;

        if (game.userTurnId != ctx.from.id) {
            await ctx.answerCbQuery("Wait for your turn...");

            return
        }

        boards = await updateBoard(position, player, battleId, "BATTLE", otherPlayerId, ctx);
        await updateOpponentBoard(boards, battleId, player, otherPlayerId, messageId, ctx);

        if (checkWin(boards, player)) {
            await ctx.answerCbQuery("You Won...", {
                show_alert: true
            });

            await ctx.editMessageText("You Won...", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Replay", callback_data: `replay_${battleId}_${otherPlayerId}` }]
                    ]
                }
            });

            await ctx.telegram.editMessageText(otherPlayerId, messageId, undefined, "You Loose...", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Replay", callback_data: `replay_${battleId}_${ctx.from.id}` }]
                    ]
                }
            });

            await prisma.board.deleteMany({
                where: {
                    gameId: battleId
                }
            })

            await prisma.users.update({
                where: {
                    userID: ctx.from.id.toString()
                },
                data: {
                    battleWon: {
                        increment: 1
                    }
                }
            })

            await prisma.users.update({
                where: {
                    userID: otherPlayerId
                },
                data: {
                    battleLost: {
                        increment: 1
                    }
                }
            })


            return;
        }

        if (isDraw(boards)) {
            await ctx.editMessageText("Battle Draw !!...", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Replay", callback_data: `replay_${battleId}_${otherPlayerId}` }]
                    ]
                }
            });
            await ctx.telegram.editMessageText(otherPlayerId, messageId, undefined, "Battle Draw !!...", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Replay", callback_data: `replay_${battleId}_${ctx.from.id}` }]
                    ]
                }
            });

            await prisma.game.delete({
                where: {
                    id: battleId
                }
            })

            await prisma.users.update({
                where: {
                    userID: ctx.from.id.toString()
                },
                data: {
                    battleDraw: {
                        increment: 1
                    }
                }
            })

            await prisma.users.update({
                where: {
                    userID: otherPlayerId
                },
                data: {
                    battleDraw: {
                        increment: 1
                    }
                }
            })

            return;
        }

        await prisma.game.update({
            where: {
                id: battleId
            },
            data: {
                userTurnId: game.userTurnId === game.creatorId ? game.otherUserId : game.creatorId,
            }
        })

    }

    if (command === "groupbattle") {
        const game = await prisma.game.findFirst({
            where: {
                id: battleId
            },
            select: {
                userTurnId: true,
                creatorId: true,
                otherUserId: true,
                messageId: true
            }
        })

        if (!game) {
            await ctx.editMessageText("Something went wrong... Start a new game.");

            return;
        }

        const player = game.userTurnId === game.creatorId ? "O" : "X";
        const otherPlayerId = game.userTurnId === game.creatorId ? game.otherUserId : game.creatorId

        if (![game.creatorId, game.otherUserId].includes(ctx.from.id.toString())) {
            await ctx.answerCbQuery("Your are not a member of this battle.", {
                show_alert: true
            });

            return;
        }

        if (game.userTurnId != ctx.from.id) {
            await ctx.answerCbQuery("Wait for your turn...");

            return
        }

        const boards = await updateBoard(position, player, battleId, "GROUPBATTLE", otherPlayerId, ctx);

        if (checkWin(boards, player)) {
            await ctx.answerCbQuery("You Won...", {
                show_alert: true
            });

            const user = await prisma.users.findFirst({
                where: {
                    userID: otherPlayerId
                }
            })

            const mainName = player === "O" ? ctx.from.first_name : user.firstName;
            const secondaryName = player === "X" ? ctx.from.first_name : user.firstName;

            await ctx.editMessageText(`<b>Battle: ${mainName} vs ${secondaryName}</b>\n\n${ctx.from.first_name} Won... +1 experience point`, {
                parse_mode: "HTML"
            });

            await prisma.game.delete({
                where: {
                    id: battleId
                }
            })

            await prisma.users.update({
                where: {
                    userID: ctx.from.id.toString()
                },
                data: {
                    battleWon: {
                        increment: 1
                    }
                }
            })

            await prisma.users.update({
                where: {
                    userID: otherPlayerId
                },
                data: {
                    battleLost: {
                        increment: 1
                    }
                }
            })


            return;
        }

        if (isDraw(boards)) {
            const user = await prisma.users.findFirst({
                where: {
                    userID: otherPlayerId
                }
            })

            const mainName = player === "O" ? ctx.from.first_name : user.firstName;
            const secondaryName = player === "X" ? ctx.from.first_name : user.firstName;

            await ctx.editMessageText(`<b>Battle: ${mainName} vs ${secondaryName}</b>\n\nBattle Draw !!...`, {
                parse_mode: "HTML"
            });

            await prisma.game.delete({
                where: {
                    id: battleId
                }
            })

            await prisma.users.update({
                where: {
                    userID: ctx.from.id.toString()
                },
                data: {
                    battleDraw: {
                        increment: 1
                    }
                }
            })

            await prisma.users.update({
                where: {
                    userID: otherPlayerId
                },
                data: {
                    battleDraw: {
                        increment: 1
                    }
                }
            })

            return;
        }

        await prisma.game.update({
            where: {
                id: battleId
            },
            data: {
                userTurnId: game.userTurnId === game.creatorId ? game.otherUserId : game.creatorId
            }
        })
    }

    if (command === "replay") {
        const game = await prisma.game.update({
            where: {
                id: battleId
            },
            data: {
                boards: {
                    createMany: {
                        data: [...Array(9)].map((_, index) => ({
                            position: index + 1,
                            sign: "",
                        }))
                    }
                },
                userTurnId: position
            }
        });

        const user = await prisma.users.findFirst({
            where: {
                userID: position
            }
        });

        // const otherPlayerId = game.userTurnId === game.creatorId ? game.otherUserId : game.creatorId;
        const messageId = ctx.from.id.toString() === game.creatorId ? game.otherUserMessageId : game.creatorMessageId;

        const inline_keyboard = [
            [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 1}` })),
            [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 4}` })),
            [...Array(3)].map((_, index) => ({ text: " ", callback_data: `playbattle_${battleId}_${index + 7}` }))
        ]

        await ctx.editMessageText(`Tap on a Box to place a sign:\n\n${user.firstName}'s Turn (O)`, {
            reply_markup: {
                inline_keyboard
            }
        })

        await ctx.telegram.editMessageText(position, messageId, undefined, "Tap on a Box to place a sign:\n\nYour Turn (X)", {
            reply_markup: {
                inline_keyboard
            }
        });

        return;
    }

    if (command === "used") {
        await ctx.answerCbQuery("Used Box... Try another one", {
            show_alert: true
        })

        return;
    }

    //Broadcast query

    if (command === "cancel") {
        const broadcast = await prisma.broadcast.findFirst();

        if (broadcast?.status === "idle") {
            await ctx.answerCbQuery("Nothing to cancel...", {
                show_alert: true
            })
            await ctx.deleteMessage(ctx.callbackQuery.message.message_id);

            return;
        }

        await ctx.reply("Do you really wants to cancal broadcast ?", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Yes", callback_data: "yes" }, { text: "No", callback_data: "no" }]
                ]
            }
        })
    }

    if (command === "yes") {
        await prisma.broadcast.update({
            where: {
                id: process.env.broadcast_id
            },
            data: {
                status: "idle"
            }
        })

        await ctx.answerCbQuery("Broadcast will be cancel as soon as possible", {
            show_alert: true
        })

        await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
    }

    if (command === "no") {
        await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
        await ctx.answerCbQuery("Don't disturb me buddy...", {
            show_alert: true
        });
    }

})

// Dev only
// bot.launch(() => {
//     console.log("Ready to go...")
// })

app.listen(process.env.PORT || 3000, () => {
    console.log("APP LISTENING");
})