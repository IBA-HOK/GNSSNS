const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database.js'); // 修正：database.jsから接続をインポート

const app = express();
const PORT = 3000;
const JWT_SECRET = 'your_jwt_secret_key'; // 本番環境では環境変数にしてください

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Base64画像を扱うため上限を増やす
app.use(express.static('public'));

// JWTトークンを検証するミドルウェア
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401); // トークンがない

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // トークンが無効
        req.user = user;
        next();
    });
};


// ユーザー登録
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'ユーザー名とパスワードは必須です。' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const avatar = `https://i.pravatar.cc/150?u=${username}`;
        const sql = 'INSERT INTO users (username, password, avatar_url) VALUES (?, ?, ?)';
        
        db.run(sql, [username, hashedPassword, avatar], function(err) {
            if (err) {
                console.error(err.message);
                return res.status(500).json({ error: 'ユーザー登録に失敗しました。ユーザー名が既に使用されている可能性があります。' });
            }
            res.status(201).json({ message: '登録が成功しました。', userId: this.lastID });
        });
    } catch (error) {
        res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});


// ログイン (修正箇所)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username = ?';

    db.get(sql, [username], async (err, user) => {
        try {
            if (err) {
                console.error("DB Error on login:", err);
                return res.status(500).json({ error: 'データベースエラーが発生しました。' });
            }
            if (!user) {
                // ユーザーが存在しない場合
                return res.status(400).json({ error: 'ユーザー名またはパスワードが違います。' });
            }

            // パスワードを比較
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                // パスワードが一致した場合、JWTを生成
                const accessToken = jwt.sign({ id: user.id, username: user.username, avatar_url: user.avatar_url }, JWT_SECRET, { expiresIn: '1d' });
                res.json({ accessToken });
            } else {
                // パスワードが一致しない場合
                res.status(400).json({ error: 'ユーザー名またはパスワードが違います。' });
            }
        } catch (error) {
            console.error("Login endpoint internal error:", error);
            res.status(500).json({ error: 'サーバー内部でエラーが発生しました。' });
        }
    });
});


// 全ての投稿を取得
app.get('/api/posts', (req, res) => {
    const sql = `
        SELECT p.id, p.image_url, p.text, p.lat, p.lng, p.timestamp, u.username as user_name, u.avatar_url as user_avatar
        FROM posts p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.timestamp ASC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ "error": err.message });
            return;
        }
        res.json(rows);
    });
});

// 新規投稿
app.post('/api/posts', verifyToken, (req, res) => {
    const { image_url, text, lat, lng } = req.body;
    const userId = req.user.id;
    const sql = 'INSERT INTO posts (image_url, text, lat, lng, user_id) VALUES (?, ?, ?, ?, ?)';
    db.run(sql, [image_url, text, lat, lng, userId], function(err) {
        if (err) {
            res.status(500).json({ "error": err.message });
            return;
        }
        res.status(201).json({ id: this.lastID });
    });
});

// 特定の投稿のコメントを取得
app.get('/api/posts/:id/comments', (req, res) => {
    const sql = `
        SELECT c.id, c.text, c.timestamp, u.username as user_name, u.avatar_url as user_avatar
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = ?
        ORDER BY c.timestamp ASC
    `;
    db.all(sql, [req.params.id], (err, rows) => {
        if (err) {
            res.status(500).json({ "error": err.message });
            return;
        }
        res.json(rows);
    });
});

// コメントを投稿
app.post('/api/posts/:id/comments', verifyToken, (req, res) => {
    const { text } = req.body;
    const userId = req.user.id;
    const postId = req.params.id;
    const sql = 'INSERT INTO comments (text, post_id, user_id) VALUES (?, ?, ?)';

    db.run(sql, [text, postId, userId], function(err) {
        if (err) {
            res.status(500).json({ "error": err.message });
            return;
        }
        res.status(201).json({ id: this.lastID });
    });
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

