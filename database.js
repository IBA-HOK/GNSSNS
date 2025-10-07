const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite', (err) => {
    if (err) {
        // データベース接続時にエラーが発生した場合
        console.error("データベース接続エラー:", err.message);
    } else {
        console.log('SQLiteデータベースに接続しました。');
    }
});

// 各処理を同期的に実行するためのserialize
db.serialize(() => {
    // ユーザーテーブル
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            avatar_url TEXT NOT NULL
        )
    `);

    // 投稿テーブル
    db.run(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_url TEXT NOT NULL,
            text TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // コメントテーブル
    db.run(`
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (post_id) REFERENCES posts(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 初回起動時にサンプルデータを挿入
    const checkUsers = `SELECT COUNT(*) as count FROM users`;
    db.get(checkUsers, (err, row) => {
        if (err) {
            return console.error(err.message);
        }

        if (row.count === 0) {
            console.log("データベースに初期データを投入します...");
            const stmt = db.prepare("INSERT INTO users (username, password, avatar_url) VALUES (?, ?, ?)");
            // パスワードは事前にハッシュ化してある想定
            stmt.run("旅人A", "$2b$10$D9y3jD.Tj.iXoIZn.F3ZbeJgS.4U3CgS.7r7iEaB.3w4c5v6x7y8z", "https://i.pravatar.cc/150?u=user1");
            stmt.run("旅人B", "$2b$10$E9z4kD.Vk.jYpLAn.G4aCeKhT.5V4DdS.8s8jFbC.4x5d6w7y8z9a", "https://i.pravatar.cc/150?u=user2");
            stmt.finalize();
        }
    });
});

// データベース接続オブジェクトをエクスポートする
module.exports = db;

