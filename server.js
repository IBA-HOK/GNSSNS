const express = require('express');
const db = require('./database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const exifr = require('exifr'); // exif-parserからexifrに変更
const sharp = require('sharp');

const app = express();
const port = 3000;
const SECRET_KEY = 'your_very_secret_key_that_is_long_and_secure';

app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// --- API Endpoints ---

// User Registration
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'ユーザー名とパスワードは必須です。' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const avatar_url = `https://i.pravatar.cc/150?u=${username}`;
        const sql = `INSERT INTO users (username, password, avatar_url) VALUES (?, ?, ?)`;
        db.run(sql, [username, hashedPassword, avatar_url], function (err) {
            if (err) {
                return res.status(400).json({ error: 'このユーザー名は既に使用されています。' });
            }
            res.status(201).json({ message: '登録が成功しました。', userId: this.lastID });
        });
    } catch (error) {
        res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

// User Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const sql = `SELECT * FROM users WHERE username = ?`;
    db.get(sql, [username], async (err, user) => {
        if (err || !user) {
            return res.status(400).json({ error: 'ユーザー名またはパスワードが違います。' });
        }
        try {
            if (await bcrypt.compare(password, user.password)) {
                const accessToken = jwt.sign({ id: user.id, username: user.username, avatar_url: user.avatar_url }, SECRET_KEY, { expiresIn: '1d' });
                res.json({ accessToken });
            } else {
                res.status(400).json({ error: 'ユーザー名またはパスワードが違います。' });
            }
        } catch (error) {
            res.status(500).json({ error: 'サーバーエラーが発生しました。' });
        }
    });
});

// Image Upload, Compression, and EXIF Parsing (FIXED)
// server.js の既存の /api/upload-and-parse エンドポイントを置き換え

// Image Upload and Compression (No EXIF Parsing)
app.post('/api/upload-and-compress', upload.single('photo'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '画像ファイルが見つかりません。' });
    }

    try {
        // Compress image using sharp
        const compressedImageBuffer = await sharp(req.file.buffer)
            .resize(800)
            .jpeg({ quality: 80 })
            .toBuffer();
        const base64Image = `data:image/jpeg;base64,${compressedImageBuffer.toString('base64')}`;
        
        // 座標情報は不要なので返さない
        res.json({
            success: true,
            image_url: base64Image
        });

    } catch (error) {
        console.error("画像圧縮エラー:", error);
        res.status(500).json({ error: '画像の処理中にエラーが発生しました。' });
    }
});

// Get all posts
app.get('/api/posts', (req, res) => {
    const sql = `
        SELECT posts.id, posts.image_url, posts.text, posts.lat, posts.lng, posts.timestamp,
               users.username as user_name, users.avatar_url as user_avatar
        FROM posts
        JOIN users ON posts.user_id = users.id
        ORDER BY posts.timestamp ASC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Create a new post
app.post('/api/posts', authenticateToken, (req, res) => {
    const { image_url, text, lat, lng } = req.body;
    const user_id = req.user.id;

    const sql = `INSERT INTO posts (image_url, text, lat, lng, user_id) VALUES (?, ?, ?, ?, ?)`;
    db.run(sql, [image_url, text, lat, lng, user_id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id: this.lastID });
    });
});
app.delete('/api/posts/:id', authenticateToken, (req, res) => {
    const post_id = req.params.id;
    const user_id = req.user.id;

    const getSql = `SELECT user_id FROM posts WHERE id = ?`;
    db.get(getSql, [post_id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: "データベースエラーが発生しました。" });
        }
        if (!row) {
            return res.status(404).json({ error: "投稿が見つかりません。" });
        }
        if (row.user_id !== user_id) {
            return res.status(403).json({ error: "この投稿を削除する権限がありません。" });
        }

        // 所有者であれば、まず関連するコメントを削除
        const deleteCommentsSql = `DELETE FROM comments WHERE post_id = ?`;
        db.run(deleteCommentsSql, [post_id], function(err) {
            if (err) {
                return res.status(500).json({ error: "コメントの削除中にエラーが発生しました。" });
            }

            // 次に投稿自体を削除
            const deletePostSql = `DELETE FROM posts WHERE id = ?`;
            db.run(deletePostSql, [post_id], function(err) {
                if (err) {
                    return res.status(500).json({ error: "投稿の削除中にエラーが発生しました。" });
                }
                res.status(200).json({ message: '投稿が正常に削除されました。' });
            });
        });
    });
});

// Get comments for a post
app.get('/api/posts/:id/comments', (req, res) => {
    const sql = `
        SELECT comments.id, comments.text, comments.timestamp,
               users.username as user_name, users.avatar_url as user_avatar
        FROM comments
        JOIN users ON comments.user_id = users.id
        WHERE comments.post_id = ?
        ORDER BY comments.timestamp ASC
    `;
    db.all(sql, [req.params.id], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Create a new comment
app.post('/api/posts/:id/comments', authenticateToken, (req, res) => {
    const { text } = req.body;
    const post_id = req.params.id;
    const user_id = req.user.id;

    const sql = `INSERT INTO comments (text, post_id, user_id) VALUES (?, ?, ?)`;
    db.run(sql, [text, post_id, user_id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id: this.lastID });
    });
});


app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});