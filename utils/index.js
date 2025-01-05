import crypto from "crypto";
import { prisma } from "../config/prisma.js";

const BROADCAST_AS_COPY = true;

export const generateId = (length) => {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

export const checkWin = (board, player) => {
    const winLines = [ // Horizontal lines 
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        // Vertical lines 
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        // Diagonal lines 
        [0, 4, 8],
        [2, 4, 6]
    ];

    for (let line of winLines) {
        const [a, b, c] = line;
        if (board[a].sign === player && board[b].sign === player && board[c].sign === player) {
            return true;
        }
    }
    return false;
}

export const isDraw = (board) => {
    for (let i = 0; i < board.length; i++) {
        if (board[i].sign === "") {
            return false;
        }
    }

    return true;
}

export const updateBoard = async (pos, sign, gameId, type, otherUserId, ctx) => {
    await prisma.board.update({
        where: {
            gameId_position: {
                gameId,
                position: parseInt(pos)
            }

        },
        data: {
            sign
        }
    })

    const boards = await prisma.board.findMany({
        where: {
            gameId
        }
    })

    let user = undefined;

    if (otherUserId) {
        user = await prisma.users.findFirst({
            where: {
                userID: otherUserId
            }
        })
    }

    const result = [];
    const chunkSize = 3;

    for (let i = 0; i < boards.length; i += chunkSize) {
        const chunk = boards.slice(i, i + chunkSize);
        result.push(chunk);
    }

    const groupText = `<b>Battle: ${sign === "O" ? ctx.from.first_name : user?.firstName
        } vs ${sign === "X" ? ctx.from.first_name : user?.firstName}</b>\n\nTap on a Box to place a sign:\n\n${user?.firstName}'s Turn (${sign === "O" ? "X" : "O"})`

    const text = type === "CHILL" ?
        sign === "X" ? "Tap on a Box to place a sign:\n\nComputer Turn... (O)" : "Tap on a Box to place a sign:\n\nYour Turn... (X)"
        : type === "GROUPBATTLE" ? groupText : `Tap on a Box to place a sign:\n\n${user?.firstName}'s Turn... (${sign === "O" ? "X" : "O"})`

    await ctx.editMessageText(text, {
        reply_markup: {
            inline_keyboard: [
                result[0].map((board, index) => ({ text: board.sign || " ", callback_data: `${board.sign ? "used" : type === "BATTLE" ? "playbattle" : type === "GROUPBATTLE" ? "groupbattle" : "play"}_${gameId}_${index + 1}` })),
                result[1].map((board, index) => ({ text: board.sign || " ", callback_data: `${board.sign ? "used" : type === "BATTLE" ? "playbattle" : type === "GROUPBATTLE" ? "groupbattle" : "play"}_${gameId}_${index + 4}` })),
                result[2].map((board, index) => ({ text: board.sign || " ", callback_data: `${board.sign ? "used" : type === "BATTLE" ? "playbattle" : type === "GROUPBATTLE" ? "groupbattle" : "play"}_${gameId}_${index + 7}` })),
            ]
        },
        parse_mode: "HTML"
    })

    return boards;
}

export const updateOpponentBoard = async (boards, gameId, sign, userId, messageId, ctx) => {
    const result = [];
    const chunkSize = 3;

    for (let i = 0; i < boards.length; i += chunkSize) {
        const chunk = boards.slice(i, i + chunkSize);
        result.push(chunk);
    }

    const text = `Tap on a Box to place a sign:\n\nYour Turn... (${sign === "O" ? "X" : "O"})`;

    try {
        const res = await ctx.telegram.editMessageText(userId, messageId, undefined, text, {
            reply_markup: {
                inline_keyboard: [
                    result[0].map((board, index) => ({ text: board.sign || " ", callback_data: `${board.sign ? "used" : "playbattle"}_${gameId}_${index + 1}` })),
                    result[1].map((board, index) => ({ text: board.sign || " ", callback_data: `${board.sign ? "used" : "playbattle"}_${gameId}_${index + 4}` })),
                    result[2].map((board, index) => ({ text: board.sign || " ", callback_data: `${board.sign ? "used" : "playbattle"}_${gameId}_${index + 7}` })),
                ]
            }
        })
    } catch (error) {
        if (error.toString().includes("400: Bad Request: message to edit not found")) {
            await ctx.reply("Game canceled !!");

            const game = await prisma.game.delete({
                where: {
                    id: gameId
                }
            })

            const otherPlayerId = game.userTurnId === game.creatorId ? game.otherUserId : game.creatorId;
            const messageId = game.userTurnId === game.creatorId ? game.otherUserMessageId : game.creatorMessageId;

            await ctx.telegram.editMessageText(otherPlayerId, messageId, undefined, "Game canceled. Oponent stopped the game.")
        }
    }
}

export const createGame = async (type = "CHILL", userId, otherUserId, userTurnId) => {
    const battleId = generateId(8)

    const boardData = [...Array(9)].map((_, index) => ({
        position: index + 1,
        sign: "",
    }))

    await prisma.game.create({
        data: {
            id: battleId,
            creatorId: userId,
            otherUserId: otherUserId || "",
            type,
            userTurnId: userTurnId || type === "BATTLE" ? "" : type === "GROUPBATTLE" ? otherUserId : userId,
            boards: {
                createMany: {
                    data: boardData
                }
            }
        }
    })

    return battleId;
}

export const minimax = (board, depth, isMaximizing, maxDepth) => {
    if (checkWin(board, "O")) return 10 - depth;
    if (checkWin(board, "X")) return depth - 10;
    if (isDraw(board)) return 0;
    if (depth === maxDepth) return 0;

    const scores = [];
    const moves = [];

    board.forEach((cell, index) => {
        if (cell.sign === "") {
            const newBoard = board.slice();
            newBoard[index].sign = isMaximizing ? "O" : "X";

            const score = minimax(newBoard, depth + 1, !isMaximizing, maxDepth);
            scores.push(score);
            moves.push(index);
        }
    });

    if (isMaximizing) {
        const maxScoreIndex = scores.indexOf(Math.max(...scores));
        return depth === 0 ? moves[maxScoreIndex] : scores[maxScoreIndex];
    } else {
        const minScoreIndex = scores.indexOf(Math.min(...scores));
        return depth === 0 ? moves[minScoreIndex] : scores[minScoreIndex];
    }
}

export const saveUser = async (ctx) => {
    const user = await prisma.users.findFirst({
        where: {
            userID: ctx.from.id.toString()
        }
    });

    if (user) return;

    await prisma.users.create({
        data: {
            userID: ctx.from.id.toString(),
            userName: ctx.from.username || "",
            firstName: ctx.from.first_name || "",
            lastName: ctx.from.last_name || "",
            languageCode: ctx.from.language_code || "en",
            isPremium: ctx.from.is_premium || false,
            addedToAttachementMenu: ctx.from.added_to_attachment_menu || false,
        }
    })

}

export const parseErrorMessage = (errorMessage) => {
    // Regular expressions to match the error codes and retry after time

    const errorCodeRegex = /Error:\s*(\d{3}):/;
    const retryAfterRegex = /retry after\s*(\d+)/;

    const errorCodeMatch = errorMessage.match(errorCodeRegex);
    const retryAfterMatch = errorMessage.match(retryAfterRegex);

    let errorCode = null;
    let retryAfter = null;
    let restOfError = null;

    // Check if it's a 429 error code and get the retry after time 
    if (errorCode === 429 && retryAfterMatch) {
        retryAfter = parseInt(retryAfterMatch[1], 10);
    } else {
        // Get the rest of the error message after the error code 
        // restOfError = errorMessage.substring(errorCodeMatch?.index + errorCodeMatch[0]?.length).trim();
        restOfError = "";
    }

    return { errorCode, retryAfter, restOfError };
}

export const sendMsg = async (userId, message, ctx) => {
    try {
        if (BROADCAST_AS_COPY === false) {
            await ctx.telegram.forwardMessage(userId, message.chatId, message.message_id);
        } else {
            await ctx.telegram.copyMessage(userId, message.chatId, message.message_id);
        }

        return { status: 200, msg: null };
    } catch (error) {
        const { errorCode, retryAfter } = parseErrorMessage(error.toString());

        if (errorCode === 429) {
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));

            return sendMsg(userId, message);
        } else if (errorCode === 403) {
            if (error.description.includes('user is deactivated')) {
                return { status: 400, msg: `${userId} : deactivated\n` };
            } else if (error.description.includes('bot was blocked by the user')) {
                return { status: 400, msg: `${userId} : blocked the bot\n` };
            }
        } else if (errorCode === 400) {
            if (error.description.includes('Bad Request: chat not found')) {
                return { status: 400, msg: `${userId} : user id invalid\n` };
            }
        }

        return { status: 500, msg: `${userId} : ${error}\n` };
    }
}

export const getUsers = async (cursor = 1, skip = false) => {
    const users = await prisma.users.findMany({
        cursor: {
            userID: cursor
        },
        orderBy: {
            id: "asc"
        },
        take: 2,
        skip: skip ? 1 : 0
    })

    return users
}

export const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s `;
}

export const main = async (cursor = 0, done, failed, success, mainMsg, startTime, message, ctx) => {
    const broadcast = await prisma.broadcast.findFirst();

    if (broadcast?.status === "idle") {
        await ctx.telegram.sendMessage(message.chatId, "Broadcast stopped...");

        return
    }

    const totalUsers = await prisma.users.count();
    let users = await getUsers(cursor, done == 0 ? false : true);

    for (const user of users) {
        const { status, msg } = await sendMsg(user.userID, message, ctx);

        if (status === 200) {
            success += 1;
        } else {
            failed += 1;
        }

        if (status === 400) {
            console.log("Deleted");

            // await prisma.users.delete({
            //     where: {
            //         userID: user.userID
            //     }
            // })
        }

        done += 1;
    }

    cursor = users[users.length - 1]?.userID;

    if (users.length < 2) {
        const completedIn = Date.now() - startTime;

        await ctx.telegram.deleteMessage(message.chatId, mainMsg);
        await ctx.telegram.sendMessage(message.chatId, `Broadcast completed in ${formatTime(completedIn)}\n\nTotal users ${totalUsers}.\nTotal done ${done}, ${success} success and ${failed} failed.`);

        return;
    };

    await ctx.telegram.editMessageText(message.chatId, mainMsg, undefined, `Broadcasting...\n\nTotal users ${totalUsers}.\nTotal done ${done}, ${success} success and ${failed} failed.`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Cancel", callback_data: "cancel" }]
            ]
        }
    })

    setTimeout(async () => await main(cursor, done, failed, success, mainMsg, startTime, message, ctx), 5000);
}
