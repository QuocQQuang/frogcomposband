#include "angband.h"

#include "z-doc.h"

#include <assert.h>

/* The Message Queue */
static int       _msg_max = 500;
static int       _msg_count = 0;
static msg_ptr  *_msgs = NULL;
static int       _msg_head = 0;
static bool      _msg_append = FALSE;

/* The Message "Line" */
static rect_t    _msg_line_rect;
static doc_ptr   _msg_line_doc = NULL;
static doc_pos_t _msg_line_sync_pos;
static doc_pos_t _msg_line_last_msg_pos;

/* The Persistent Combat Log (bottom of screen, never cleared on command) */
static char  _combat_log[COMBAT_LOG_LINES][1024];
static byte  _combat_log_color[COMBAT_LOG_LINES];
static int   _combat_log_write = 0;  /* next slot to write (mod COMBAT_LOG_LINES) */
static int   _combat_log_total = 0;  /* total messages ever added */

/* Forward declaration – defined at bottom of file */
static void _render_combat_log(void);


msg_ptr _msg_alloc(cptr s)
{
    msg_ptr m = malloc(sizeof(msg_t));
    m->msg = string_copy_s(s);
    m->turn = 0;
    m->count = 1;
    m->color = TERM_WHITE;
    return m;
}

void _msg_free(msg_ptr m)
{
    if (m)
    {
        string_free(m->msg);
        free(m);
    }
}

void msg_on_startup(void)
{
    int cb = _msg_max * sizeof(msg_ptr);
    _msgs = malloc(cb);
    memset(_msgs, 0, cb);
    _msg_count = 0;
    _msg_head = 0;
    _msg_append = FALSE;

    memset(_combat_log, 0, sizeof(_combat_log));
    memset(_combat_log_color, TERM_WHITE, sizeof(_combat_log_color));
    _combat_log_write = 0;
    _combat_log_total = 0;

    msg_line_init(ui_msg_rect());
}


void msg_on_shutdown(void)
{
    int i;
    for (i = 0; i < _msg_max; i++)
        _msg_free(_msgs[i]);
    free(_msgs);
}

static int _msg_index(int age)
{
    assert(0 <= age && age < _msg_max);
    return (_msg_head + _msg_max - (age + 1)) % _msg_max;
}

int msg_count(void)
{
    return _msg_count;
}

msg_ptr msg_get(int age)
{
    int i = _msg_index(age);
    return _msgs[i];
}

int msg_get_plain_text(int age, char *buffer, int max)
{
    int         ct = 0, i;
    doc_token_t token;
    msg_ptr     msg = msg_get(age);
    cptr        pos = string_buffer(msg->msg);
    bool        done = FALSE;

    while (!done)
    {
        pos = doc_lex(pos, &token);
        if (token.type == DOC_TOKEN_EOF) break;
        if (token.type == DOC_TOKEN_TAG) continue; /* assume only color tags */
        for (i = 0; i < token.size; i++)
        {
            if (ct >= max - 4)
            {
                buffer[ct++] = '.';
                buffer[ct++] = '.';
                buffer[ct++] = '.';
                done = TRUE;
                break;
            }
            buffer[ct++] = token.pos[i];
        }
    }
    buffer[ct] = '\0';
    return ct;
}

void msg_add(cptr str)
{
    cmsg_add(TERM_WHITE, str);
}

void cmsg_append(byte color, cptr str)
{
    if (!_msg_count)
        cmsg_add(color, str);
    else
    {
        msg_ptr m = msg_get(0);

        assert(m);

        /* Repeat last message? Even when appending, this scenario
         * is common. For example: "A tree was blasted! (x4)" */
        if (strcmp(string_buffer(m->msg), str) == 0)
        {
            m->count++;
            return;
        }

        /* You tunnel into the granite wall. (x17) The heroism wears off.
           Not: You tunnel into the granite wall. The heroism wears off. (x17) */
        if (m->count > 1)
        {
            cmsg_add(color, str);
            return;
        }
        if (string_length(m->msg) && strlen(str) > 1)
            string_append_c(m->msg, ' ');
        if (color != m->color)
            string_printf(m->msg, "<color:%c>%s</color>", attr_to_attr_char(color), str);
        else
            string_append_s(m->msg, str);
    }
}

void _cmsg_add_aux(byte color, cptr str, int turn, int count)
{
    msg_ptr m;

    /* Repeat last message? */
    if (_msg_count)
    {
        m = msg_get(0);
        if (strcmp(string_buffer(m->msg), str) == 0)
        {
            m->count += count;
            m->turn = turn;
            m->color = color;
            return;
        }
    }

    m = _msgs[_msg_head];
    if (!m)
    {
        m = _msg_alloc(NULL);
        _msgs[_msg_head] = m;
        _msg_count++;
    }
    else
    {
        string_clear(m->msg);
        string_shrink(m->msg, 128);
    }
    string_append_s(m->msg, str);

    m->turn = turn;
    m->count = count;
    m->color = color;

    _msg_head = (_msg_head + 1) % _msg_max;
}

void cmsg_add(byte color, cptr str)
{
    _cmsg_add_aux(color, str, player_turn, 1);
}

rect_t msg_line_rect(void)
{
    assert(_msg_line_doc); /* call msg_on_startup()! */
    return rect(
        _msg_line_rect.x,
        _msg_line_rect.y,
        _msg_line_rect.cx,
        doc_line_count(_msg_line_doc)
    );
}

void msg_line_init(rect_t display_rect)
{
    assert(rect_is_valid(display_rect));
    if (_msg_line_doc)
    {
        msg_line_clear();
        doc_free(_msg_line_doc);
    }
    _msg_line_rect = display_rect;
    if (_msg_line_rect.x + _msg_line_rect.cx > Term->wid)
        _msg_line_rect.cx = Term->wid - _msg_line_rect.x;
    _msg_line_doc = doc_alloc(_msg_line_rect.cx);
    _msg_line_sync_pos = doc_cursor(_msg_line_doc);
    _msg_line_last_msg_pos = doc_cursor(_msg_line_doc);
}

void msg_boundary(void)
{
    _msg_append = FALSE;
    if (auto_more_state == AUTO_MORE_SKIP_BLOCK)
    {
        /* Flush before updating the state to skip
           the remnants of the last message from the
           previous message block */
        msg_print(NULL);
        auto_more_state = AUTO_MORE_PROMPT;
    }
}

bool msg_line_contains(int row, int col)
{
    rect_t r = msg_line_rect();
    if (col < 0)
        col = r.x;
    if (row < 0)
        row = r.y;
    return rect_contains_pt(r, col, row);
}

bool msg_line_is_empty(void)
{
    doc_pos_t cursor = doc_cursor(_msg_line_doc);
    if (cursor.x == 0 && cursor.y == 0)
        return TRUE;
    return FALSE;
}

void msg_line_clear(void)
{
    int i;
    int y = doc_cursor(_msg_line_doc).y;

    for (i = 0; i <= y; i++)
    {
        int row = _msg_line_rect.y + i;
        int cx = row ? _msg_line_rect.cx : 255; /* Hack */
        Term_erase(_msg_line_rect.x, row, cx);
    }
    doc_rollback(_msg_line_doc, doc_pos_create(0, 0));
    _msg_line_sync_pos = doc_cursor(_msg_line_doc);
    _msg_line_last_msg_pos = doc_cursor(_msg_line_doc);

    if (y > 0)
    {
        /* Note: We need not redraw the entire map if this proves too slow */
        p_ptr->redraw |= PR_MAP;
        if (_msg_line_rect.x <= 12)
            p_ptr->redraw |= PR_BASIC | PR_EQUIPPY;
    }
}

void msg_line_redraw(void)
{
    doc_sync_term(
        _msg_line_doc,
        doc_range_all(_msg_line_doc),
        doc_pos_create(_msg_line_rect.x, _msg_line_rect.y)
    );
    _msg_line_sync_pos = doc_cursor(_msg_line_doc);
}

static void msg_line_sync(void)
{
    doc_sync_term(
        _msg_line_doc,
        doc_range_bottom(_msg_line_doc, _msg_line_sync_pos),
        doc_pos_create(_msg_line_rect.x, _msg_line_rect.y + _msg_line_sync_pos.y)
    );
    _msg_line_sync_pos = doc_cursor(_msg_line_doc);
/*  inkey(); */
}

static void msg_line_flush(void)
{
    /* Non-blocking flush: never interrupt gameplay with "-more-".
     * We keep the normal message queue/history; only the transient line
     * display is cleared to make room for subsequent messages. */
    msg_line_clear();
}


static void msg_line_display(byte color, cptr msg)
{
    int len = strlen(msg);

    /* Hack for better display of repeated messages. For example, messages
     * while resting or tunneling can force multiple -more- prompts. */
    if (character_generated)
    {
        msg_ptr m = msg_get(0);
        if (m->count > 1)
        {
            doc_rollback(_msg_line_doc, _msg_line_last_msg_pos);
            _msg_line_sync_pos = _msg_line_last_msg_pos;
            doc_insert_text(_msg_line_doc, m->color, string_buffer(m->msg));
            doc_printf(_msg_line_doc, " (x%d)", m->count);
            msg_line_sync();
            /* For testing: inkey();*/
            return;
        }
    }

    /* Quick and dirty test for -more- ... This means _msg_line_display_rect
       is just a suggested limit, and we'll surpass this for long messages. */
    if (doc_cursor(_msg_line_doc).y >= _msg_line_rect.cy && len > 1)
        msg_line_flush();

    /* Append this message to the last? */
    else if (!_msg_append && !msg_line_is_empty() && doc_cursor(_msg_line_doc).x > 0)
        doc_newline(_msg_line_doc);

    if (doc_cursor(_msg_line_doc).x > 0 && len > 1)
        doc_insert_char(_msg_line_doc, TERM_WHITE, ' ');
    _msg_line_last_msg_pos = doc_cursor(_msg_line_doc); /* remember in case this message repeats */
    doc_insert_text(_msg_line_doc, color, msg);
    msg_line_sync();
}

/* Prompt the user for a choice:
   [1] keys[0] is the default choice if quick_messages and PROMPT_FORCE_CHOICE is not set.
   [2] keys[0] is returned on ESC if PROMPT_ESCAPE_DEFAULT is set.
   [3] You get back the char in the keys prompt, not the actual character pressed.
       This makes a difference if PROMPT_CASE_SENSITIVE is not set (and simplifies
       your coding).

   Sample Usage:
   char ch = msg_prompt("Really commit suicide? [Y,n]", "nY", PROMPT_NEW_LINE | PROMPT_CASE_SENSITIVE);
   if (ch == 'Y') {...}
*/
static char msg_prompt_imp(cptr prompt, char keys[], int options)
{
    if (options & PROMPT_NEW_LINE)
        msg_boundary();

    auto_more_state = AUTO_MORE_PROMPT;
    msg_print(prompt);

    {
        mouse_context_t old_ctx = mouse_context;
        mouse_context = MOUSE_CTX_PROMPT;
        for (;;)
        {
            char ch = inkey();
            int  i;

            if (ch == TERM_MOUSE_MOVE_KEY) continue;
            if (ch == TERM_MOUSE_KEY)
            {
                mouse_event_t ev;
                if (!mouse_get_event(&ev)) continue;
                if (ev.button == TERM_MOUSE_BUTTON_RIGHT)
                {
                    ch = ESCAPE;
                }
                else
                {
                    int choice = mouse_find_choice(&ev);
                    if (!choice) continue;
                    ch = (char)choice;
                }
            }

            if (ch == ESCAPE && (options & PROMPT_ESCAPE_DEFAULT))
            {
                mouse_context = old_ctx;
                return keys[0];
            }

            if (ch == '\r' && (options & PROMPT_RETURN_1))
            {
                mouse_context = old_ctx;
                return keys[1];
            }

            for (i = 0; ; i++)
            {
                char choice = keys[i];
                if (!choice) break;
                if (ch == choice) { mouse_context = old_ctx; return choice; }
                if (!(options & PROMPT_CASE_SENSITIVE))
                {
                    if (tolower(ch) == tolower(choice))
                    {
                        mouse_context = old_ctx;
                        return choice;
                    }
                }
            }

            if (!(options & PROMPT_FORCE_CHOICE) && quick_messages)
            {
                mouse_context = old_ctx;
                return keys[0];
            }
        }
    }
}

char msg_prompt(cptr prompt, char keys[], int options)
{
    char ch = msg_prompt_imp(prompt, keys, options);
    if (isprint(ch))
        msg_print(format("=> <color:y>%c</color>.", ch));
    msg_line_clear();
    return ch;
}

bool paranoid_msg_prompt(cptr buf, int options)
{
    char c = msg_prompt(buf, "nY", (options | PROMPT_ESCAPE_DEFAULT | PROMPT_CASE_SENSITIVE));
    return (c == 'Y');
}

bool msg_command(cptr prompt, char *cmd)
{
    bool result = FALSE;
    mouse_context_t old_ctx = mouse_context;
    msg_boundary();
    auto_more_state = AUTO_MORE_PROMPT;
    msg_print(prompt);

    if (mouse_context == MOUSE_CTX_NONE)
        mouse_context = MOUSE_CTX_PROMPT;

    for (;;)
    {
        if (get_com_no_macros)
            *cmd = inkey_special(FALSE);
        else
            *cmd = inkey();

        if (*cmd == TERM_MOUSE_MOVE_KEY) continue;
        if (*cmd == TERM_MOUSE_KEY)
        {
            mouse_event_t ev;
            if (!mouse_get_event(&ev)) continue;
            if (ev.button == TERM_MOUSE_BUTTON_RIGHT)
            {
                *cmd = ESCAPE;
                break;
            }
            else
            {
                int choice = mouse_find_choice(&ev);
                if (!choice) continue;
                *cmd = (char)choice;
            }
        }
        break;
    }

    mouse_context = old_ctx;

    if (*cmd == ESCAPE)
        cmsg_print(TERM_L_RED, "Cancelled");
    else
    {
        if (isprint(*cmd))
            msg_print(format("=> <color:y>%c</color>.", *cmd));
        result = TRUE;
    }
    msg_line_clear();
    return result;
}

bool msg_input(cptr prompt, char *buf, int len)
{
    bool result = FALSE;
    msg_boundary();
    auto_more_state = AUTO_MORE_PROMPT;
    msg_print(prompt);
    result = askfor(buf, len);
    if (result)
        msg_print(buf);
    else
        cmsg_print(TERM_L_RED, "Cancelled");
    msg_line_clear();
    return result;
}

void cmsg_print(byte color, cptr msg)
{
    if (world_monster) return;
    if (statistics_hack) return;

    /* Hack: msg_print(NULL) requests a flush if needed */
    if (!msg)
    {
        if (!msg_line_is_empty())
            msg_line_flush();
        return;
    }

    if (character_generated)
    {
        if (_msg_append && _msg_count)
            cmsg_append(color, msg);
        else
            cmsg_add(color, msg);

        /* Feed every non-prompt message into the persistent combat log.
         * cmsg_combat() would double-add to history, so we directly
         * write to the ring buffer and render. */
        {
            int slot = _combat_log_write % COMBAT_LOG_LINES;
            strncpy(_combat_log[slot], msg, sizeof(_combat_log[0]) - 1);
            _combat_log[slot][sizeof(_combat_log[0]) - 1] = '\0';
            _combat_log_color[slot] = color;
            _combat_log_write = (_combat_log_write + 1) % COMBAT_LOG_LINES;
            _combat_log_total++;
            _render_combat_log();
        }
    }

    msg_line_display(color, msg);

    if (auto_more_state == AUTO_MORE_SKIP_ONE)
        auto_more_state = AUTO_MORE_PROMPT;

    p_ptr->window |= PW_MESSAGE;

    if (fresh_message)
        Term_fresh();

    _msg_append = TRUE;
}

void msg_print(cptr msg)
{
    cmsg_print(TERM_WHITE, msg);
}

/* Note: Angband uses proprietary format strings, like %^s
   that string_vprintf() won't handle. So, let's hope 1024
   is enough for every message! (It should be ...) */
void msg_format(cptr fmt, ...)
{
    va_list vp;
    char buf[1024];

    va_start(vp, fmt);
    (void)vstrnfmt(buf, 1024, fmt, vp);
    va_end(vp);

    cmsg_print(TERM_WHITE, buf);
}

void cmsg_format(byte color, cptr fmt, ...)
{
    va_list vp;
    char buf[1024];

    va_start(vp, fmt);
    (void)vstrnfmt(buf, 1024, fmt, vp);
    va_end(vp);

    cmsg_print(color, buf);
}

void msg_on_load(savefile_ptr file)
{
    int i;
    int count = savefile_read_s16b(file);

    for (i = 0; i < count; i++)
    {
        s32b turn = 0;
        s32b count = 0;
        byte color = TERM_WHITE;
        string_ptr msg = 0;

        msg = savefile_read_string(file);
        turn = savefile_read_s32b(file);
        count = savefile_read_s32b(file);
        color = savefile_read_byte(file);

        _cmsg_add_aux(color, string_buffer(msg), turn, count);
        string_free(msg);
    }
}

void msg_on_save(savefile_ptr file)
{
    int i;
    int count = msg_count();
    if (compress_savefile && count > 40) count = 40;

    savefile_write_u16b(file, count);
    for (i = count - 1; i >= 0; i--)
    {
        msg_ptr m = msg_get(i);
        savefile_write_cptr(file, string_buffer(m->msg));
        savefile_write_s32b(file, m->turn);
        savefile_write_s32b(file, m->count);
        savefile_write_byte(file, m->color);
    }
}

bool msg_input_num(cptr prompt, int *num, int min, int max)
{
    bool result = FALSE;
    char buf[11] = {0};

    sprintf(buf, "%d", MAX(min, MIN(max, *num)));
    msg_boundary();
    auto_more_state = AUTO_MORE_PROMPT;
    msg_format("<color:y>%s <color:w>(%d to %d)</color>:</color> ", prompt, min, max);
    result = askfor_aux(buf, 11, FALSE);
    if (result)
    {
        if (isalpha(buf[0]))
            *num = max;
        else
            *num = atoi(buf);

        if (*num > max) *num = max;
        if (*num < min) *num = min;

        cmsg_format(TERM_YELLOW, "%d", *num);
    }
    else
        cmsg_print(TERM_L_RED, "Cancelled");
    msg_line_clear();
    return result;
}

/* ===================================================================
 * Persistent Combat Log
 * Renders last COMBAT_LOG_LINES messages directly at the bottom of
 * the screen (via combat_log_rect() from xtra2.c). Never cleared when
 * the player opens a command/menu - only scrolled when new msgs arrive.
 * =================================================================== */

static void _render_combat_log(void)
{
    rect_t  r = combat_log_rect();
    int     i, n, slot, row;
    doc_ptr doc;

    if (!Term) return;

    n = MIN(_combat_log_total, COMBAT_LOG_LINES);

    /* Clear the 5 combat log rows */
    for (i = 0; i < COMBAT_LOG_LINES; i++)
        Term_erase(r.x, r.y + i, r.cx);

    if (n == 0) return;

    /* Use a doc_ptr so that color markup <color:x>...</color> is parsed.
     * Term_putstr() only draws raw text and would show tags literally. */
    doc = doc_alloc(r.cx);

    for (i = 0; i < n; i++)
    {
        int age = n - 1 - i;   /* 0 = newest, n-1 = oldest visible */
        slot = (_combat_log_write - 1 - age + COMBAT_LOG_LINES * 1000) % COMBAT_LOG_LINES;
        row  = r.y + (COMBAT_LOG_LINES - n) + i;

        /* Reset doc to beginning for each line */
        doc_rollback(doc, doc_pos_create(0, 0));

        /* Insert text – this parses color markup correctly */
        doc_insert_text(doc, _combat_log_color[slot], _combat_log[slot]);

        /* Sync exactly one line to the target terminal row */
        doc_sync_term(doc,
            doc_range_all(doc),
            doc_pos_create(r.x, row));
    }

    doc_free(doc);
}


/* Called by screen_load() after Term_load() to repaint the combat area */
void combat_log_redraw(void)
{
    _render_combat_log();
}

/* cmsg_combat: now delegates to cmsg_print which auto-feeds the combat log.
 * Kept as a named API for readability and in case callers bypass cmsg_print. */
void cmsg_combat(byte color, cptr msg)
{
    cmsg_print(color, msg);
}

void msg_combat(cptr msg)
{
    cmsg_print(TERM_WHITE, msg);
}

void cmsg_combat_format(byte color, cptr fmt, ...)
{
    va_list vp;
    char    buf[1024];

    va_start(vp, fmt);
    (void)vstrnfmt(buf, sizeof(buf), fmt, vp);
    va_end(vp);

    cmsg_print(color, buf);
}

void msg_combat_format(cptr fmt, ...)
{
    va_list vp;
    char    buf[1024];

    va_start(vp, fmt);
    (void)vstrnfmt(buf, sizeof(buf), fmt, vp);
    va_end(vp);

    cmsg_print(TERM_WHITE, buf);
}

