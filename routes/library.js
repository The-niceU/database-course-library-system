'use strict';
const db = require('../coSqlite3');

function trimVal(val) {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

function escapeHtml(val) {
  const str = val === null || val === undefined ? '' : String(val);
  return str.replace(/[&<>"']/g, function (ch) {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return ch;
    }
  });
}

function htmlMessage(code, message) {
  const msg = message ? escapeHtml(message) : '';
  return `<html><body><div id='result' style='display:none'>${code}</div>${msg}</body></html>`;
}

function htmlTable(rows) {
  let htm = "<html><head><META HTTP-EQUIV='Content-Type' Content='text-html;charset=utf-8'></head><body><table border=1 id='result'>";
  for (const row of rows) {
    htm += '<tr>' + row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('') + '</tr>';
  }
  htm += '</table></body></html>';
  return htm;
}

function isPositiveInt(val) {
  return /^[1-9]\d*$/.test(val);
}

function parseDateStrict(val) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
  const parts = val.split('-').map((item) => parseInt(item, 10));
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) {
    return null;
  }
  return date;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function todayString() {
  return formatDate(new Date());
}

module.exports = function (app) {
  app.route('/library/init', 'post', function* initDatabase() {
    try {
      yield db.execSQL([
        { sql: 'DROP TABLE IF EXISTS borrows' },
        { sql: 'DROP TABLE IF EXISTS readers' },
        { sql: 'DROP TABLE IF EXISTS books' },
        { sql: `CREATE TABLE books (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          publisher TEXT,
          pub_date TEXT,
          author TEXT,
          summary TEXT,
          total_count INTEGER NOT NULL CHECK(total_count >= 0),
          available_count INTEGER NOT NULL CHECK(available_count >= 0)
        )` },
        { sql: `CREATE TABLE readers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sex TEXT NOT NULL CHECK(sex IN ('男','女')),
          dept TEXT,
          grade INTEGER NOT NULL CHECK(grade > 0)
        )` },
        { sql: `CREATE TABLE borrows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reader_id TEXT NOT NULL,
          book_id TEXT NOT NULL,
          borrow_date TEXT NOT NULL,
          due_date TEXT NOT NULL,
          return_date TEXT,
          FOREIGN KEY(reader_id) REFERENCES readers(id) ON DELETE CASCADE,
          FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
        )` },
        { sql: `CREATE UNIQUE INDEX idx_borrow_unique_active
          ON borrows(reader_id, book_id)
          WHERE return_date IS NULL` }
      ], true);
      return htmlMessage(0, '成功');
    } catch (err) {
      return htmlMessage(1, '初始化失败：' + (err && err.message ? err.message : String(err)));
    }
  });

  app.route('/library/books/add', 'post', function* addBook(req) {
    const body = req.body || {};
    const bID = trimVal(body.bID);
    const bName = trimVal(body.bName);
    const bPub = trimVal(body.bPub);
    const bDate = trimVal(body.bDate);
    const bAuthor = trimVal(body.bAuthor);
    const bMem = trimVal(body.bMem);
    const bCnt = trimVal(body.bCnt);

    if (!bID || bID.length > 30 || !bName || bName.length > 30 || !isPositiveInt(bCnt) || bPub.length > 30 || bAuthor.length > 20 || bMem.length > 30 || (bDate && !parseDateStrict(bDate))) {
      return htmlMessage(2, '提交的参数有误：请检查书号、书名、数量和其他字段格式');
    }

  const existing = yield db.execSQL('SELECT id FROM books WHERE id = ?', [bID]);
    if (existing.length) {
      return htmlMessage(1, '该书已经存在');
    }

    const count = parseInt(bCnt, 10);
    yield db.execSQL('INSERT INTO books (id, name, publisher, pub_date, author, summary, total_count, available_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [bID, bName, bPub || null, bDate || null, bAuthor || null, bMem || null, count, count]);
    return htmlMessage(0, '成功');
  });

  app.route('/library/books/increase', 'post', function* increaseBook(req) {
    const body = req.body || {};
    const bID = trimVal(body.bID);
    const bCnt = trimVal(body.bCnt);

    if (!bID || bID.length > 30 || !isPositiveInt(bCnt)) {
      return htmlMessage(2, '提交的参数有误：请提供合法的书号和数量');
    }

  const rows = yield db.execSQL('SELECT total_count, available_count FROM books WHERE id = ?', [bID]);
    if (!rows.length) {
      return htmlMessage(1, '该书不存在');
    }

    const delta = parseInt(bCnt, 10);
    yield db.execSQL('UPDATE books SET total_count = total_count + ?, available_count = available_count + ? WHERE id = ?',
      [delta, delta, bID]);
    return htmlMessage(0, '成功');
  });

  app.route('/library/books/decrease', 'post', function* decreaseBook(req) {
    const body = req.body || {};
    const bID = trimVal(body.bID);
    const bCnt = trimVal(body.bCnt);

    if (!bID || bID.length > 30 || !isPositiveInt(bCnt)) {
      return htmlMessage(3, '提交的参数有误：请提供合法的书号和数量');
    }

    const rows = yield db.execSQL('SELECT total_count, available_count FROM books WHERE id = ?', [bID]);
    if (!rows.length) {
      return htmlMessage(1, '该书不存在');
    }

    const info = rows[0];
    const delta = parseInt(bCnt, 10);
    if (delta > info.available_count) {
      return htmlMessage(2, '减少的数量大于该书目前在库数量');
    }

    if (info.total_count <= delta) {
      yield db.execSQL('DELETE FROM books WHERE id = ?', [bID]);
    } else {
      yield db.execSQL('UPDATE books SET total_count = total_count - ?, available_count = available_count - ? WHERE id = ?',
        [delta, delta, bID]);
    }
    return htmlMessage(0, '成功');
  });

  app.route('/library/books/update', 'post', function* updateBook(req) {
    const body = req.body || {};
    const bID = trimVal(body.bID);
    const payload = {
      bName: trimVal(body.bName),
      bPub: trimVal(body.bPub),
      bDate: trimVal(body.bDate),
      bAuthor: trimVal(body.bAuthor),
      bMem: trimVal(body.bMem)
    };

    if (!bID || bID.length > 30 || !payload.bName || payload.bName.length > 30 || payload.bPub.length > 30 || payload.bAuthor.length > 20 || payload.bMem.length > 30 || (payload.bDate && !parseDateStrict(payload.bDate))) {
      return htmlMessage(2, '提交的参数有误：请检查书号、书名及其他字段格式');
    }

  const rows = yield db.execSQL('SELECT id FROM books WHERE id = ?', [bID]);
    if (!rows.length) {
      return htmlMessage(1, '该书不存在');
    }

    yield db.execSQL('UPDATE books SET name = ?, publisher = ?, pub_date = ?, author = ?, summary = ? WHERE id = ?',
      [payload.bName, payload.bPub || null, payload.bDate || null, payload.bAuthor || null, payload.bMem || null, bID]);
    return htmlMessage(0, '成功');
  });

  app.route('/library/books/search', 'post', function* searchBooks(req) {
    const body = req.body || {};
    const bID = trimVal(body.bID);
    const bName = trimVal(body.bName);
    const bPub = trimVal(body.bPub);
    const bDate0 = trimVal(body.bDate0);
    const bDate1 = trimVal(body.bDate1);
    const bAuthor = trimVal(body.bAuthor);
    const bMem = trimVal(body.bMem);

    const clauses = [];
    const args = [];

    if (bID) {
      clauses.push('id LIKE ?');
      args.push('%' + bID + '%');
    }
    if (bName) {
      clauses.push('name LIKE ?');
      args.push('%' + bName + '%');
    }
    if (bPub) {
      clauses.push('publisher LIKE ?');
      args.push('%' + bPub + '%');
    }
    if (bAuthor) {
      clauses.push('author LIKE ?');
      args.push('%' + bAuthor + '%');
    }
    if (bMem) {
      clauses.push('summary LIKE ?');
      args.push('%' + bMem + '%');
    }
    let fromDate = null;
    let toDate = null;
    if (bDate0) {
      const parsed = parseDateStrict(bDate0);
      if (parsed) fromDate = parsed;
    }
    if (bDate1) {
      const parsed = parseDateStrict(bDate1);
      if (parsed) toDate = parsed;
    }
    if (fromDate && toDate && fromDate > toDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }
    if (fromDate) {
      clauses.push('pub_date >= ?');
      args.push(formatDate(fromDate));
    }
    if (toDate) {
      clauses.push('pub_date <= ?');
      args.push(formatDate(toDate));
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = yield db.execSQL(
      `SELECT id, name, total_count, available_count, COALESCE(publisher, '') AS publisher, COALESCE(pub_date, '') AS pub_date, COALESCE(author, '') AS author, COALESCE(summary, '') AS summary FROM books ${where} ORDER BY id`,
      args
    );

    const tableRows = rows.map((row) => [row.id, row.name, row.total_count, row.available_count, row.publisher, row.pub_date, row.author, row.summary]);
    return htmlTable(tableRows);
  });

  app.route('/library/readers/add', 'post', function* addReader(req) {
    const body = req.body || {};
    const rID = trimVal(body.rID);
    const rName = trimVal(body.rName);
    const rSex = trimVal(body.rSex);
    const rDept = trimVal(body.rDept);
    const rGrade = trimVal(body.rGrade);

    if (!rID || rID.length > 8 || !rName || rName.length > 10 || !rSex || (rSex !== '男' && rSex !== '女') || (rDept && rDept.length > 10) || !isPositiveInt(rGrade)) {
      return htmlMessage(2, '提交的参数有误：请检查证号、姓名、性别和年级');
    }

  const existing = yield db.execSQL('SELECT id FROM readers WHERE id = ?', [rID]);
    if (existing.length) {
      return htmlMessage(1, '该证号已经存在');
    }

    yield db.execSQL('INSERT INTO readers (id, name, sex, dept, grade) VALUES (?, ?, ?, ?, ?)',
      [rID, rName, rSex, rDept || null, parseInt(rGrade, 10)]);
    return htmlMessage(0, '成功');
  });

  app.route('/library/readers/remove', 'post', function* removeReader(req) {
    const body = req.body || {};
    const rID = trimVal(body.rID);

    if (!rID || rID.length > 8) {
      return htmlMessage(1, '该证号不存在');
    }

  const existing = yield db.execSQL('SELECT id FROM readers WHERE id = ?', [rID]);
    if (!existing.length) {
      return htmlMessage(1, '该证号不存在');
    }

    const outstanding = yield db.execSQL('SELECT 1 FROM borrows WHERE reader_id = ? AND return_date IS NULL LIMIT 1', [rID]);
    if (outstanding.length) {
      return htmlMessage(2, '该读者尚有书籍未归还');
    }

  yield db.execSQL('DELETE FROM readers WHERE id = ?', [rID]);
    return htmlMessage(0, '成功');
  });

  app.route('/library/readers/update', 'post', function* updateReader(req) {
    const body = req.body || {};
    const rID = trimVal(body.rID);
    const rName = trimVal(body.rName);
    const rSex = trimVal(body.rSex);
    const rDept = trimVal(body.rDept);
    const rGrade = trimVal(body.rGrade);

    if (!rID || rID.length > 8) {
      return htmlMessage(2, '提交的参数有误：请提供合法的证号');
    }

  const existing = yield db.execSQL('SELECT id FROM readers WHERE id = ?', [rID]);
    if (!existing.length) {
      return htmlMessage(1, '该证号不存在');
    }

    const updates = [];
    const args = [];
    if (rName) {
      if (rName.length > 10) {
        return htmlMessage(2, '提交的参数有误：姓名过长');
      }
      updates.push('name = ?');
      args.push(rName);
    }
    if (rSex) {
      if (rSex !== '男' && rSex !== '女') {
        return htmlMessage(2, '提交的参数有误：性别必须为男或女');
      }
      updates.push('sex = ?');
      args.push(rSex);
    }
    if (rDept) {
      if (rDept.length > 10) {
        return htmlMessage(2, '提交的参数有误：系名过长');
      }
      updates.push('dept = ?');
      args.push(rDept);
    }
    if (rGrade) {
      if (!isPositiveInt(rGrade)) {
        return htmlMessage(2, '提交的参数有误：年级必须是正整数');
      }
      updates.push('grade = ?');
      args.push(parseInt(rGrade, 10));
    }

    if (!updates.length) {
      return htmlMessage(0, '成功');
    }

    args.push(rID);
  yield db.execSQL(`UPDATE readers SET ${updates.join(', ')} WHERE id = ?`, args);
    return htmlMessage(0, '成功');
  });

  app.route('/library/readers/search', 'post', function* searchReaders(req) {
    const body = req.body || {};
    const rID = trimVal(body.rID);
    const rName = trimVal(body.rName);
    const rSex = trimVal(body.rSex);
    const rDept = trimVal(body.rDept);
    const rGrade0 = trimVal(body.rGrade0);
    const rGrade1 = trimVal(body.rGrade1);

    const clauses = [];
    const args = [];

    if (rID) {
      clauses.push('id LIKE ?');
      args.push('%' + rID + '%');
    }
    if (rName) {
      clauses.push('name LIKE ?');
      args.push('%' + rName + '%');
    }
    if (rDept) {
      clauses.push('dept LIKE ?');
      args.push('%' + rDept + '%');
    }
    if (rSex) {
      if (rSex === '男' || rSex === '女') {
        clauses.push('sex = ?');
        args.push(rSex);
      }
    }
    let gradeMin = null;
    let gradeMax = null;
    if (rGrade0 && isPositiveInt(rGrade0)) {
      gradeMin = parseInt(rGrade0, 10);
    }
    if (rGrade1 && isPositiveInt(rGrade1)) {
      gradeMax = parseInt(rGrade1, 10);
    }
    if (gradeMin !== null && gradeMax !== null && gradeMin > gradeMax) {
      const tmp = gradeMin;
      gradeMin = gradeMax;
      gradeMax = tmp;
    }
    if (gradeMin !== null) {
      clauses.push('grade >= ?');
      args.push(gradeMin);
    }
    if (gradeMax !== null) {
      clauses.push('grade <= ?');
      args.push(gradeMax);
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = yield db.execSQL(
      `SELECT id, name, sex, COALESCE(dept, '') AS dept, grade FROM readers ${where} ORDER BY id`,
      args
    );

    const tableRows = rows.map((row) => [row.id, row.name, row.sex, row.dept, row.grade]);
    return htmlTable(tableRows);
  });

  app.route('/library/readers/loans', 'post', function* readerLoans(req) {
    const body = req.body || {};
    const rID = trimVal(body.rID);

    if (!rID || rID.length > 8) {
      return htmlMessage(1, '该证号不存在');
    }

    const reader = yield db.execSQL('SELECT id FROM readers WHERE id = ?', [rID]);
    if (!reader.length) {
      return htmlMessage(1, '该证号不存在');
    }

    const rows = yield db.execSQL(
      `SELECT br.book_id AS bID, bk.name AS bName, br.borrow_date AS borrowDate, br.due_date AS dueDate,
            CASE WHEN julianday('now') - julianday(br.borrow_date) > 60 THEN '是' ELSE '否' END AS overdue
          FROM borrows br
          JOIN books bk ON br.book_id = bk.id
          WHERE br.reader_id = ? AND br.return_date IS NULL
          ORDER BY br.borrow_date`,
      [rID]
    );

    const tableRows = rows.map((row) => [row.bID, row.bName, row.borrowDate, row.dueDate, row.overdue]);
    return htmlTable(tableRows);
  });

  app.route('/library/borrow', 'post', function* borrowBook(req) {
    const body = req.body || {};
    const rID = trimVal(body.rID);
    const bID = trimVal(body.bID);

    if (!rID || rID.length > 8) {
      return htmlMessage(1, '该证号不存在');
    }
    if (!bID || bID.length > 30) {
      return htmlMessage(2, '该书号不存在');
    }

    const reader = yield db.execSQL('SELECT id FROM readers WHERE id = ?', [rID]);
    if (!reader.length) {
      return htmlMessage(1, '该证号不存在');
    }
    const bookRows = yield db.execSQL('SELECT id, available_count FROM books WHERE id = ?', [bID]);
    if (!bookRows.length) {
      return htmlMessage(2, '该书号不存在');
    }

    const overdueRows = yield db.execSQL(
      `SELECT 1 FROM borrows WHERE reader_id = ? AND return_date IS NULL AND julianday('now') - julianday(borrow_date) > 60 LIMIT 1`,
      [rID]
    );
    if (overdueRows.length) {
      return htmlMessage(3, '该读者有超期书未还');
    }

    const duplicated = yield db.execSQL('SELECT 1 FROM borrows WHERE reader_id = ? AND book_id = ? AND return_date IS NULL LIMIT 1', [rID, bID]);
    if (duplicated.length) {
      return htmlMessage(4, '该读者已经借阅该书，且未归还');
    }

    const book = bookRows[0];
    if (book.available_count <= 0) {
      return htmlMessage(5, '该书已经全部借出');
    }

    const today = new Date();
    const borrowDate = formatDate(today);
    const dueDate = formatDate(addDays(today, 60));

    try {
      yield db.execSQL([
        {
          sql: 'INSERT INTO borrows (reader_id, book_id, borrow_date, due_date) VALUES (?, ?, ?, ?)',
          args: [rID, bID, borrowDate, dueDate]
        },
        {
          sql: 'UPDATE books SET available_count = available_count - 1 WHERE id = ?',
          args: [bID]
        }
      ], true);
    } catch (err) {
      return htmlMessage(6, '借书失败：' + (err && err.message ? err.message : String(err)));
    }

    return htmlMessage(0, '成功');
  });

  app.route('/library/return', 'post', function* returnBook(req) {
    const body = req.body || {};
    const rID = trimVal(body.rID);
    const bID = trimVal(body.bID);

    if (!rID || rID.length > 8) {
      return htmlMessage(1, '该证号不存在');
    }
    if (!bID || bID.length > 30) {
      return htmlMessage(2, '该书号不存在');
    }

    const reader = yield db.execSQL('SELECT id FROM readers WHERE id = ?', [rID]);
    if (!reader.length) {
      return htmlMessage(1, '该证号不存在');
    }
    const bookRows = yield db.execSQL('SELECT id FROM books WHERE id = ?', [bID]);
    if (!bookRows.length) {
      return htmlMessage(2, '该书号不存在');
    }

    const borrowRows = yield db.execSQL('SELECT id FROM borrows WHERE reader_id = ? AND book_id = ? AND return_date IS NULL LIMIT 1', [rID, bID]);
    if (!borrowRows.length) {
      return htmlMessage(3, '该读者并未借阅该书');
    }

    const borrowId = borrowRows[0].id;
    const returnDate = todayString();

    yield db.execSQL([
      { sql: 'UPDATE borrows SET return_date = ? WHERE id = ?', args: [returnDate, borrowId] },
      { sql: 'UPDATE books SET available_count = available_count + 1 WHERE id = ?', args: [bID] }
    ], true);

    return htmlMessage(0, '成功');
  });

  app.route('/library/overdue', 'post', function* overdueReaders() {
    const rows = yield db.execSQL(
      `SELECT DISTINCT rd.id, rd.name, rd.sex, COALESCE(rd.dept, '') AS dept, rd.grade
            FROM readers rd
            JOIN borrows br ON rd.id = br.reader_id
            WHERE br.return_date IS NULL AND julianday('now') - julianday(br.borrow_date) > 60
            ORDER BY rd.id`
    );

    const tableRows = rows.map((row) => [row.id, row.name, row.sex, row.dept, row.grade]);
    return htmlTable(tableRows);
  });
};
