/* File: main-web.c */

/*
 * Web frontend driver for FrogComposband.
 *
 * Speaks line-delimited JSON over stdin/stdout so a local Node/WebSocket bridge
 * can present a modern HTML5 Canvas + Glassmorphic HUD + Web Audio UI.
 */

#ifdef USE_WEB

#include "angband.h"
#include "pack.h"
#include "equip.h"

#ifdef WINDOWS
# include <windows.h>
# include <io.h>
# include <fcntl.h>
#else
# include <sys/select.h>
# include <unistd.h>
#endif

#define WEB_MAX_W 200
#define WEB_MAX_H 100
#define WEB_DEF_W 108
#define WEB_DEF_H 36
#define WEB_SOUND_QUEUE_MAX 64
#define WEB_INBUF_SIZE 8192

typedef struct web_term_data web_term_data;
struct web_term_data
{
    term t;
    int w;
    int h;
    byte prev_a[WEB_MAX_H][WEB_MAX_W];
    char prev_c[WEB_MAX_H][WEB_MAX_W];
    byte prev_ta[WEB_MAX_H][WEB_MAX_W];
    char prev_tc[WEB_MAX_H][WEB_MAX_W];
    int prev_cx;
    int prev_cy;
    bool prev_cv;
    int prev_w;
    int prev_h;
    bool force_full;
};

static web_term_data web_terms[1];
static int sound_queue[WEB_SOUND_QUEUE_MAX];
static int sound_queue_len = 0;
static bool web_initialized = FALSE;
static bool web_eof = FALSE;
static int web_hover_ui_x = -1;
static int web_hover_ui_y = -1;
static char web_inbuf[WEB_INBUF_SIZE];
static int web_inbuf_len = 0;
static cptr web_graf_mode = "overhaul";

/* Forward declarations */
static void web_emit_frame(bool force_state);
static void web_emit_hover_info(int ui_x, int ui_y);

static void web_json_str(FILE *fp, cptr s)
{
    const unsigned char *p = (const unsigned char *)s;
    fputc('"', fp);
    if (p)
    {
        while (*p)
        {
            unsigned char ch = *p++;
            switch (ch)
            {
            case '"':  fputs("\\\"", fp); break;
            case '\\': fputs("\\\\", fp); break;
            case '\b': fputs("\\b", fp); break;
            case '\f': fputs("\\f", fp); break;
            case '\n': fputs("\\n", fp); break;
            case '\r': fputs("\\r", fp); break;
            case '\t': fputs("\\t", fp); break;
            default:
                if (ch < 0x20 || ch >= 0x7f)
                    fprintf(fp, "\\u%04x", (unsigned int)ch);
                else
                    fputc((int)ch, fp);
                break;
            }
        }
    }
    fputc('"', fp);
}

static void web_queue_sound(int val)
{
    if (sound_queue_len < WEB_SOUND_QUEUE_MAX)
        sound_queue[sound_queue_len++] = val;
}

static void web_set_graphics_mode(cptr mode)
{
    int old_graf = use_graphics;
    if (!mode || streq(mode, "overhaul"))
    {
        use_graphics = GRAPHICS_ADAM_BOLT;
        arg_graphics = GRAPHICS_ADAM_BOLT;
        ANGBAND_GRAF = "new";
        web_graf_mode = "overhaul";
    }
    else if (streq(mode, "proc32"))
    {
        use_graphics = GRAPHICS_ADAM_BOLT;
        arg_graphics = GRAPHICS_ADAM_BOLT;
        ANGBAND_GRAF = "proc32";
        web_graf_mode = "proc32";
    }
    else if (streq(mode, "new") || streq(mode, "16x16"))
    {
        use_graphics = GRAPHICS_ADAM_BOLT;
        arg_graphics = GRAPHICS_ADAM_BOLT;
        ANGBAND_GRAF = "new";
        web_graf_mode = "new";
    }
    else if (streq(mode, "old") || streq(mode, "8x8"))
    {
        use_graphics = GRAPHICS_ORIGINAL;
        arg_graphics = GRAPHICS_ORIGINAL;
        ANGBAND_GRAF = "old";
        web_graf_mode = "old";
    }
    else
    {
        use_graphics = GRAPHICS_NONE;
        arg_graphics = GRAPHICS_NONE;
        ANGBAND_GRAF = "ascii";
        web_graf_mode = "ascii";
    }

    web_terms[0].t.higher_pict = (use_graphics != GRAPHICS_NONE);
    web_terms[0].force_full = TRUE;

    if (character_dungeon)
    {
        reset_visuals();
        if (old_graf != use_graphics || use_graphics != GRAPHICS_NONE)
            do_cmd_redraw();
    }
    else
    {
        Term_redraw();
    }
    web_emit_frame(TRUE);
}

static int web_parse_int(cptr line, cptr key, int defval)
{
    char pat[64];
    cptr p;
    sprintf(pat, "\"%s\":", key);
    p = strstr(line, pat);
    if (!p) return defval;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t') p++;
    return atoi(p);
}

static bool web_parse_str(cptr line, cptr key, char *out, int out_sz)
{
    char pat[64];
    cptr p;
    int i = 0;
    sprintf(pat, "\"%s\":\"", key);
    p = strstr(line, pat);
    if (!p) return FALSE;
    p += strlen(pat);
    while (*p && *p != '"' && i < out_sz - 1)
    {
        if (*p == '\\' && *(p + 1))
        {
            p++;
            switch (*p)
            {
            case 'n': out[i++] = '\n'; break;
            case 'r': out[i++] = '\r'; break;
            case 't': out[i++] = '\t'; break;
            default:  out[i++] = *p; break;
            }
            p++;
        }
        else
        {
            out[i++] = *p++;
        }
    }
    out[i] = '\0';
    return TRUE;
}

static void web_handle_line(cptr line)
{
    char type[32];
    if (!line || !*line) return;
    if (!web_parse_str(line, "type", type, sizeof(type))) return;

    if (streq(type, "key"))
    {
        int code = web_parse_int(line, "code", 0);
        if (code > 0 && code < 256)
        {
            term *old = Term;
            Term_activate(&web_terms[0].t);
            Term_keypress(code);
            if (old) Term_activate(old);
        }
    }
    else if (streq(type, "cmd"))
    {
        char str[128];
        if (web_parse_str(line, "str", str, sizeof(str)))
        {
            term *old = Term;
            int i;
            Term_activate(&web_terms[0].t);
            for (i = 0; str[i]; i++)
                Term_keypress((unsigned char)str[i]);
            if (old) Term_activate(old);
        }
    }
    else if (streq(type, "skey"))
    {
        char name[64];
        if (web_parse_str(line, "name", name, sizeof(name)))
        {
            int sh = web_parse_int(line, "shift", 0);
            int ct = web_parse_int(line, "ctrl", 0);
            term *old = Term;
            int i;
            Term_activate(&web_terms[0].t);
            Term_keypress(31);
            if (ct) Term_keypress('C');
            if (sh) Term_keypress('S');
            for (i = 0; name[i]; i++)
                Term_keypress((unsigned char)name[i]);
            Term_keypress(13);
            if (old) Term_activate(old);
        }
    }
    else if (streq(type, "mouse"))
    {
        int x = web_parse_int(line, "x", -1);
        int y = web_parse_int(line, "y", -1);
        int btn = web_parse_int(line, "btn", TERM_MOUSE_BUTTON_LEFT);
        int mods = web_parse_int(line, "mods", 0);
        if (x >= 0 && y >= 0)
        {
            term *old = Term;
            Term_activate(&web_terms[0].t);
            Term_mousepress_aux(x, y, btn, mods);
            if (old) Term_activate(old);
        }
    }
    else if (streq(type, "hover"))
    {
        int x = web_parse_int(line, "x", -1);
        int y = web_parse_int(line, "y", -1);
        web_hover_ui_x = x;
        web_hover_ui_y = y;
        if (mouse_context == MOUSE_CTX_BIRTH && x >= 0 && y >= 0)
        {
            term *old = Term;
            Term_activate(&web_terms[0].t);
            Term_mousemove_aux(x, y);
            if (old) Term_activate(old);
        }
        else if (character_dungeon && !character_icky && x >= 0 && y >= 0)
        {
            web_emit_hover_info(x, y);
        }
    }
    else if (streq(type, "resize"))
    {
        int w = web_parse_int(line, "w", WEB_DEF_W);
        int h = web_parse_int(line, "h", WEB_DEF_H);
        if (w < 80) w = 80;
        if (w > WEB_MAX_W) w = WEB_MAX_W;
        if (h < 24) h = 24;
        if (h > WEB_MAX_H) h = WEB_MAX_H;
        if (w != web_terms[0].w || h != web_terms[0].h)
        {
            term *old = Term;
            web_terms[0].w = w;
            web_terms[0].h = h;
            web_terms[0].force_full = TRUE;
            Term_activate(&web_terms[0].t);
            Term_resize(w, h);
            if (character_dungeon && !character_icky)
                do_cmd_redraw();
            else
                Term_redraw();
            if (old && old != &web_terms[0].t) Term_activate(old);
            web_emit_frame(TRUE);
        }
    }
    else if (streq(type, "graf"))
    {
        char mode[32];
        if (web_parse_str(line, "mode", mode, sizeof(mode)))
            web_set_graphics_mode(mode);
    }
    else if (streq(type, "ping"))
    {
        web_emit_frame(TRUE);
    }
    else if (streq(type, "save_quit"))
    {
        if (!character_generated || !character_dungeon)
        {
            quit(NULL);
        }
        else if (can_save && !character_icky)
        {
            term *old = Term;
            Term_activate(&web_terms[0].t);
            Term_keypress(KTRL('X'));
            if (old) Term_activate(old);
        }
        else
        {
            fputs("{\"type\":\"save_blocked\",\"msg\":\"Exit current menu or prompt first before saving, or choose Force Exit.\"}\n", stdout);
            fflush(stdout);
        }
    }
    else if (streq(type, "quit"))
    {
        quit(NULL);
    }
}

static bool web_stdin_has_data(void)
{
#ifdef WINDOWS
    HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
    DWORD avail = 0;
    DWORD ftype = GetFileType(h);
    if (ftype == FILE_TYPE_PIPE)
    {
        if (!PeekNamedPipe(h, NULL, 0, NULL, &avail, NULL))
        {
            DWORD err = GetLastError();
            if (err == ERROR_BROKEN_PIPE || err == ERROR_INVALID_HANDLE)
                web_eof = TRUE;
            return FALSE;
        }
        return avail > 0;
    }
    return FALSE;
#else
    fd_set fds;
    struct timeval tv;
    FD_ZERO(&fds);
    FD_SET(STDIN_FILENO, &fds);
    tv.tv_sec = 0;
    tv.tv_usec = 0;
    return select(STDIN_FILENO + 1, &fds, NULL, NULL, &tv) > 0;
#endif
}

static bool web_read_one_chunk(void)
{
#ifdef WINDOWS
    HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
    DWORD nread = 0;
    int space = WEB_INBUF_SIZE - 1 - web_inbuf_len;
    if (space <= 0)
    {
        web_inbuf_len = 0;
        space = WEB_INBUF_SIZE - 1;
    }
    if (!ReadFile(h, web_inbuf + web_inbuf_len, (DWORD)space, &nread, NULL) || nread == 0)
    {
        web_eof = TRUE;
        return FALSE;
    }
    web_inbuf_len += (int)nread;
    web_inbuf[web_inbuf_len] = '\0';
    return TRUE;
#else
    int space = WEB_INBUF_SIZE - 1 - web_inbuf_len;
    ssize_t nread;
    if (space <= 0)
    {
        web_inbuf_len = 0;
        space = WEB_INBUF_SIZE - 1;
    }
    nread = read(STDIN_FILENO, web_inbuf + web_inbuf_len, (size_t)space);
    if (nread <= 0)
    {
        web_eof = TRUE;
        return FALSE;
    }
    web_inbuf_len += (int)nread;
    web_inbuf[web_inbuf_len] = '\0';
    return TRUE;
#endif
}

static void web_drain_lines(void)
{
    int start = 0;
    int i;
    for (i = 0; i < web_inbuf_len; i++)
    {
        if (web_inbuf[i] == '\n')
        {
            web_inbuf[i] = '\0';
            if (i > start && web_inbuf[i - 1] == '\r')
                web_inbuf[i - 1] = '\0';
            web_handle_line(web_inbuf + start);
            start = i + 1;
        }
    }
    if (start > 0)
    {
        int rem = web_inbuf_len - start;
        if (rem > 0)
            memmove(web_inbuf, web_inbuf + start, (size_t)rem);
        web_inbuf_len = rem;
        web_inbuf[web_inbuf_len] = '\0';
    }
}

static void web_poll_input(bool block)
{
    if (web_eof) quit(NULL);

    if (!block)
    {
        while (!web_eof && web_stdin_has_data())
        {
            if (!web_read_one_chunk()) break;
            web_drain_lines();
        }
        return;
    }

    for (;;)
    {
        term *t0 = &web_terms[0].t;
        if (t0->key_head != t0->key_tail) break;
        if (web_eof) quit(NULL);
        if (!web_read_one_chunk())
        {
            quit(NULL);
            break;
        }
        web_drain_lines();
        if (t0->key_head != t0->key_tail) break;
    }
}

static void web_hover_badge(FILE *fp, bool *first, cptr label, cptr kind)
{
    if (!label || !label[0]) return;
    if (!*first) fputc(',', fp);
    *first = FALSE;
    fputs("{\"label\":", fp);
    web_json_str(fp, label);
    fputs(",\"kind\":", fp);
    web_json_str(fp, kind ? kind : "neutral");
    fputc('}', fp);
}

static void web_hover_detail(FILE *fp, bool *first, cptr text)
{
    if (!text || !text[0]) return;
    if (!*first) fputc(',', fp);
    *first = FALSE;
    web_json_str(fp, text);
}

static void web_append_token(char *buf, int bsz, cptr tok)
{
    int len = (int)strlen(buf);
    if (!tok || !tok[0]) return;
    if (len > 0 && len + 2 < bsz)
    {
        strcat(buf, ", ");
        len += 2;
    }
    if (len + (int)strlen(tok) + 1 < bsz)
        strcat(buf, tok);
}

static void web_emit_hover_info(int ui_x, int ui_y)
{
    rect_t mr = ui_map_rect();
    point_t cp;
    cave_type *c_ptr;
    feature_type *f_ptr = NULL;
    char title[160], sub[192], feat_name[96];
    char kind[24];
    int hp_pct = -1, att = -1;
    int rng, proj, los;
    bool known = FALSE;
    bool is_player = FALSE;
    monster_type *m_ptr = NULL;
    object_type *o_ptr = NULL;
    int pile_ct = 0;
    int f_idx = 0;

    if (ui_x < mr.x || ui_x >= mr.x + mr.cx || ui_y < mr.y || ui_y >= mr.y + mr.cy)
        return;

    cp = ui_pt_to_cave_pt(point(ui_x, ui_y));
    if (!in_bounds(cp.y, cp.x))
    {
        fprintf(stdout, "{\"type\":\"hover\",\"x\":%d,\"y\":%d,\"valid\":false}\n", ui_x, ui_y);
        fflush(stdout);
        return;
    }

    c_ptr = &cave[cp.y][cp.x];
    title[0] = '\0';
    sub[0] = '\0';
    feat_name[0] = '\0';
    strcpy(kind, "terrain");

    if ((c_ptr->info & (CAVE_MARK | CAVE_VIEW | CAVE_AWARE)) != 0 || p_ptr->inside_battle)
    {
        f_idx = c_ptr->mimic ? c_ptr->mimic : c_ptr->feat;
        f_ptr = &f_info[f_idx];
        my_strcpy(feat_name, f_name + f_ptr->name, sizeof(feat_name));
    }

    if (player_bold(cp.y, cp.x))
    {
        is_player = TRUE;
        known = TRUE;
        strcpy(kind, "player");
        my_strcpy(title, player_name[0] ? player_name : "You", sizeof(title));
        if (p_ptr->msp > 0)
            strnfmt(sub, sizeof(sub), "Lv %d %s %s | HP %d/%d | SP %d/%d",
                    p_ptr->lev, get_race()->name, get_class()->name,
                    p_ptr->chp, p_ptr->mhp, p_ptr->csp, p_ptr->msp);
        else
            strnfmt(sub, sizeof(sub), "Lv %d %s %s | HP %d/%d",
                    p_ptr->lev, get_race()->name, get_class()->name,
                    p_ptr->chp, p_ptr->mhp);
        hp_pct = (p_ptr->mhp > 0) ? (int)((100L * MAX(0, p_ptr->chp)) / p_ptr->mhp) : 100;
        att = 2;
    }
    else if (c_ptr->m_idx > 0 && m_list[c_ptr->m_idx].ml)
    {
        cptr alleg;
        m_ptr = &m_list[c_ptr->m_idx];
        known = TRUE;
        strcpy(kind, "monster");
        monster_desc(title, m_ptr, MD_IGNORE_HALLU | MD_ASSUME_VISIBLE);
        if (is_pet(m_ptr)) att = 2;
        else if (is_friendly(m_ptr)) att = 1;
        else att = 0;

        if (m_ptr->maxhp > 0)
            hp_pct = (int)((100L * MAX(0, m_ptr->hp)) / m_ptr->maxhp);

        alleg = is_pet(m_ptr) ? "Pet" : (is_friendly(m_ptr) ? "Friendly" : "Hostile");
        if (m_ptr->maxhp > 0)
            strnfmt(sub, sizeof(sub), "%s | %s (%d/%d HP)", alleg, mon_health_desc(m_ptr), m_ptr->hp, m_ptr->maxhp);
        else
            strnfmt(sub, sizeof(sub), "%s | %s", alleg, mon_health_desc(m_ptr));
    }

    if (c_ptr->o_idx > 0 && ((c_ptr->info & (CAVE_MARK | CAVE_VIEW)) != 0 || p_ptr->inside_battle))
    {
        s16b cur = c_ptr->o_idx;
        while (cur > 0)
        {
            object_type *it = &o_list[cur];
            if (it->marked & OM_FOUND)
            {
                if (!o_ptr) o_ptr = it;
                pile_ct++;
            }
            cur = it->next_o_idx;
        }
        if (o_ptr && !known)
        {
            known = TRUE;
            strcpy(kind, "item");
            object_desc(title, o_ptr, 0);
            if (pile_ct > 1)
                strnfmt(sub, sizeof(sub), "Stack of %d items here (top shown)", pile_ct);
            else if (object_is_artifact(o_ptr))
                my_strcpy(sub, "Artifact", sizeof(sub));
            else if (object_is_ego(o_ptr))
                my_strcpy(sub, "Ego Item", sizeof(sub));
            else if (obj_is_identified(o_ptr))
                my_strcpy(sub, "Identified Item", sizeof(sub));
            else
                my_strcpy(sub, "Unidentified Item", sizeof(sub));
        }
    }

    if (!known && f_ptr)
    {
        known = TRUE;
        strcpy(kind, "terrain");
        my_strcpy(title, feat_name, sizeof(title));
        if (have_flag(f_ptr->flags, FF_STORE))
            my_strcpy(sub, "Shop / Building Entrance", sizeof(sub));
        else if (have_flag(f_ptr->flags, FF_BLDG))
            my_strcpy(sub, "Service Building", sizeof(sub));
        else if (have_flag(f_ptr->flags, FF_STAIRS))
            my_strcpy(sub, have_flag(f_ptr->flags, FF_LESS) ? "Stairs Up (<)" : "Stairs Down (>)", sizeof(sub));
        else if (have_flag(f_ptr->flags, FF_TRAP))
            my_strcpy(sub, "Detected Trap", sizeof(sub));
        else if (have_flag(f_ptr->flags, FF_DOOR))
            my_strcpy(sub, have_flag(f_ptr->flags, FF_MOVE) ? "Open Door" : "Closed / Locked Door", sizeof(sub));
        else if (!have_flag(f_ptr->flags, FF_MOVE))
            my_strcpy(sub, have_flag(f_ptr->flags, FF_PERMANENT) ? "Permanent Obstacle" : "Blocked Terrain", sizeof(sub));
        else
            my_strcpy(sub, "Walkable Terrain", sizeof(sub));
    }

    if (!known)
    {
        fprintf(stdout, "{\"type\":\"hover\",\"x\":%d,\"y\":%d,\"valid\":false}\n", ui_x, ui_y);
        fflush(stdout);
        return;
    }

    rng = distance(py, px, cp.y, cp.x);
    proj = projectable(py, px, cp.y, cp.x) ? 1 : 0;
    los = player_has_los_bold(cp.y, cp.x) ? 1 : 0;

    fprintf(stdout, "{\"type\":\"hover\",\"x\":%d,\"y\":%d,\"valid\":true,\"cx\":%d,\"cy\":%d,\"rng\":%d,\"proj\":%d,\"los\":%d,\"kind\":",
            ui_x, ui_y, cp.x, cp.y, rng, proj, los);
    web_json_str(stdout, kind);
    fputs(",\"title\":", stdout);
    web_json_str(stdout, title);
    fputs(",\"sub\":", stdout);
    web_json_str(stdout, sub);
    fprintf(stdout, ",\"hp\":%d,\"att\":%d", hp_pct, att);

    /* Badges array */
    fputs(",\"badges\":[", stdout);
    {
        bool first_b = TRUE;
        char bbuf[96];
        if (is_player)
        {
            int pspd = p_ptr->pspeed - 110;
            strnfmt(bbuf, sizeof(bbuf), "AC %d", p_ptr->dis_ac + p_ptr->dis_to_a);
            web_hover_badge(stdout, &first_b, bbuf, "info");
            strnfmt(bbuf, sizeof(bbuf), "Speed %s%d", pspd >= 0 ? "+" : "", pspd);
            web_hover_badge(stdout, &first_b, bbuf, pspd > 0 ? "good" : (pspd < 0 ? "bad" : "neutral"));
            if (p_ptr->poisoned > 0) web_hover_badge(stdout, &first_b, "Poisoned", "bad");
            if (p_ptr->blind > 0) web_hover_badge(stdout, &first_b, "Blind", "bad");
            if (p_ptr->confused > 0) web_hover_badge(stdout, &first_b, "Confused", "bad");
            if (p_ptr->stun > 0) web_hover_badge(stdout, &first_b, "Stunned", "bad");
            if (p_ptr->cut > 0) web_hover_badge(stdout, &first_b, "Bleeding", "bad");
            if (p_ptr->afraid > 0) web_hover_badge(stdout, &first_b, "Afraid", "bad");
            if (p_ptr->fast > 0 || p_ptr->lightspeed > 0) web_hover_badge(stdout, &first_b, "Haste", "good");
            if (p_ptr->hero > 0) web_hover_badge(stdout, &first_b, "Heroism", "good");
            if (p_ptr->shero > 0) web_hover_badge(stdout, &first_b, "Berserk", "good");
            if (p_ptr->blessed > 0) web_hover_badge(stdout, &first_b, "Blessed", "good");
            if (p_ptr->shield > 0) web_hover_badge(stdout, &first_b, "Shield", "good");
        }
        else if (m_ptr)
        {
            monster_race *r_ptr = &r_info[m_ptr->r_idx];
            monster_race *ap_ptr = mon_apparent_race(m_ptr);

            /* Live statuses */
            if (MON_CSLEEP(m_ptr)) web_hover_badge(stdout, &first_b, "Sleeping", "good");
            if (MON_PARALYZED(m_ptr)) web_hover_badge(stdout, &first_b, "Paralyzed", "good");
            if (MON_STUNNED(m_ptr)) web_hover_badge(stdout, &first_b, "Stunned", "good");
            if (MON_CONFUSED(m_ptr)) web_hover_badge(stdout, &first_b, "Confused", "good");
            if (MON_MONFEAR(m_ptr)) web_hover_badge(stdout, &first_b, "Afraid", "good");
            if (MON_SLOW(m_ptr)) web_hover_badge(stdout, &first_b, "Slowed", "good");
            if (MON_FAST(m_ptr)) web_hover_badge(stdout, &first_b, "Hasted", "warn");
            if (MON_INVULNER(m_ptr)) web_hover_badge(stdout, &first_b, "Invulnerable", "bad");
            if (target_who == c_ptr->m_idx) web_hover_badge(stdout, &first_b, "Locked Target", "accent");
            if (p_ptr->riding == c_ptr->m_idx) web_hover_badge(stdout, &first_b, "Mounted", "good");

            /* Capture rules matching GF_CAPTURE in gf.c */
            if (!quests_allow_all_spells() && !is_pet(m_ptr))
            {
                web_hover_badge(stdout, &first_b, "Capture: Quest Blocked", "warn");
            }
            else if ((r_ptr->flags7 & RF7_UNIQUE2) || (m_ptr->mflag2 & MFLAG2_QUESTOR) ||
                     m_ptr->r_idx == MON_BANOR || m_ptr->r_idx == MON_LUPART ||
                     m_ptr->r_idx == MON_BANORLUPART || (m_ptr->smart & (1U << SM_CLONED)) ||
                     m_ptr->parent_m_idx)
            {
                web_hover_badge(stdout, &first_b, "Uncapturable", "neutral");
            }
            else if (((r_ptr->flags1 & RF1_UNIQUE) || (r_ptr->flags7 & RF7_NAZGUL)) && !is_pet(m_ptr))
            {
                web_hover_badge(stdout, &first_b, "Unique (No Capture)", "neutral");
            }
            else if (is_pet(m_ptr))
            {
                web_hover_badge(stdout, &first_b, "Capturable (Pet)", "good");
            }
            else
            {
                int nokori_hp;
                int pct;
                if ((p_ptr->pclass == CLASS_BEASTMASTER && monster_living(r_ptr)) || p_ptr->easy_capture)
                {
                    nokori_hp = m_ptr->maxhp * 3 / 10;
                    pct = 30;
                }
                else if (warlock_is_(WARLOCK_DRAGONS) && (r_ptr->flags3 & RF3_DRAGON))
                {
                    nokori_hp = m_ptr->maxhp * 3 / 15;
                    pct = 20;
                }
                else
                {
                    nokori_hp = m_ptr->maxhp * 3 / 20;
                    pct = 15;
                }
                if (m_ptr->hp < nokori_hp)
                {
                    strnfmt(bbuf, sizeof(bbuf), "Ready to Capture (<%d HP)", nokori_hp);
                    web_hover_badge(stdout, &first_b, bbuf, "good");
                }
                else
                {
                    strnfmt(bbuf, sizeof(bbuf), "Capturable (<%d HP / %d%%)", nokori_hp, pct);
                    web_hover_badge(stdout, &first_b, bbuf, "info");
                }
            }

            /* Classification & tactical traits */
            if (ap_ptr->flags1 & RF1_UNIQUE) web_hover_badge(stdout, &first_b, "Unique", "accent");
            if (ap_ptr->flags7 & RF7_RIDING) web_hover_badge(stdout, &first_b, "Mountable", "info");
            if (ap_ptr->spells && ap_ptr->spells->freq > 0)
            {
                strnfmt(bbuf, sizeof(bbuf), "Caster 1/%d", (int)ap_ptr->spells->freq);
                web_hover_badge(stdout, &first_b, bbuf, "warn");
            }
            if (ap_ptr->flags2 & RF2_MULTIPLY) web_hover_badge(stdout, &first_b, "Breeder", "warn");
            if (ap_ptr->flags2 & RF2_INVISIBLE) web_hover_badge(stdout, &first_b, "Invisible", "warn");
            if (ap_ptr->flags2 & RF2_PASS_WALL) web_hover_badge(stdout, &first_b, "Pass Wall", "warn");
            if (ap_ptr->flags2 & RF2_REFLECTING) web_hover_badge(stdout, &first_b, "Reflects", "warn");
            if (ap_ptr->flags2 & RF2_REGENERATE) web_hover_badge(stdout, &first_b, "Regenerates", "warn");
            if (ap_ptr->flags3 & RF3_UNDEAD) web_hover_badge(stdout, &first_b, "Undead", "neutral");
            if (ap_ptr->flags3 & RF3_DEMON) web_hover_badge(stdout, &first_b, "Demon", "bad");
            if (ap_ptr->flags3 & RF3_DRAGON) web_hover_badge(stdout, &first_b, "Dragon", "warn");
            if (ap_ptr->flags3 & RF3_EVIL) web_hover_badge(stdout, &first_b, "Evil", "bad");
            else if (ap_ptr->flags3 & RF3_GOOD) web_hover_badge(stdout, &first_b, "Good", "good");
            if (ap_ptr->flags3 & RF3_ANIMAL) web_hover_badge(stdout, &first_b, "Animal", "neutral");
            if (ap_ptr->flags3 & RF3_NONLIVING) web_hover_badge(stdout, &first_b, "Nonliving", "neutral");
        }
        else if (o_ptr)
        {
            if (object_is_artifact(o_ptr)) web_hover_badge(stdout, &first_b, "Artifact", "accent");
            else if (object_is_ego(o_ptr)) web_hover_badge(stdout, &first_b, "Ego", "good");
            if (obj_is_identified(o_ptr))
            {
                s32b val = obj_value(o_ptr);
                web_hover_badge(stdout, &first_b, "Identified", "info");
                if (val > 0)
                {
                    strnfmt(bbuf, sizeof(bbuf), "Value ~%ld gp", (long)val);
                    web_hover_badge(stdout, &first_b, bbuf, "accent");
                }
            }
            else
            {
                web_hover_badge(stdout, &first_b, "Unidentified", "warn");
            }
            if (pile_ct > 1)
            {
                strnfmt(bbuf, sizeof(bbuf), "Pile (%d)", pile_ct);
                web_hover_badge(stdout, &first_b, bbuf, "info");
            }
        }
        else if (f_ptr)
        {
            if (have_flag(f_ptr->flags, FF_STORE) || have_flag(f_ptr->flags, FF_BLDG))
                web_hover_badge(stdout, &first_b, "Enterable (<)", "accent");
            else if (have_flag(f_ptr->flags, FF_STAIRS))
                web_hover_badge(stdout, &first_b, have_flag(f_ptr->flags, FF_LESS) ? "Go Up (<)" : "Go Down (>)", "accent");
            else if (have_flag(f_ptr->flags, FF_MOVE))
                web_hover_badge(stdout, &first_b, "Passable", "good");
            else
                web_hover_badge(stdout, &first_b, "Blocked", "bad");

            if (have_flag(f_ptr->flags, FF_CAN_DIG)) web_hover_badge(stdout, &first_b, "Diggable", "info");
            if (have_flag(f_ptr->flags, FF_PERMANENT)) web_hover_badge(stdout, &first_b, "Permanent", "neutral");
            if (!have_flag(f_ptr->flags, FF_LOS)) web_hover_badge(stdout, &first_b, "Blocks Sight", "warn");
            if (have_flag(f_ptr->flags, FF_WATER)) web_hover_badge(stdout, &first_b, "Water", "info");
            if (have_flag(f_ptr->flags, FF_LAVA)) web_hover_badge(stdout, &first_b, "Lava", "bad");
            if (have_flag(f_ptr->flags, FF_TREE)) web_hover_badge(stdout, &first_b, "Tree", "good");
            if (c_ptr->info & (CAVE_GLOW | CAVE_LITE)) web_hover_badge(stdout, &first_b, "Lit", "neutral");
            else web_hover_badge(stdout, &first_b, "Dark", "neutral");
        }
    }
    fputs("]", stdout);

    /* Details lines array */
    fputs(",\"details\":[", stdout);
    {
        bool first_d = TRUE;
        char dbuf[256];
        if (is_player)
        {
            strnfmt(dbuf, sizeof(dbuf), "Light Radius: %d | Depth: %s",
                    p_ptr->cur_lite,
                    dun_level > 0 ? format("%d ft (Lv %d)", dun_level * 50, dun_level) : "Town");
            web_hover_detail(stdout, &first_d, dbuf);
            if (feat_name[0])
            {
                strnfmt(dbuf, sizeof(dbuf), "Standing on: %s", feat_name);
                web_hover_detail(stdout, &first_d, dbuf);
            }
            web_hover_detail(stdout, &first_d, "Click self: Wait 1 turn | Shift+Click: Rest");
        }
        else if (m_ptr)
        {
            monster_race *ap_ptr = mon_apparent_race(m_ptr);
            int mspd = (int)m_ptr->mspeed - 110;
            int pspd = (int)p_ptr->pspeed - 110;
            int sdiff = mspd - pspd;
            cptr rel = (sdiff > 0) ? "faster than you" : ((sdiff < 0) ? "slower than you" : "same speed");
            int blow_ct = 0;
            int bi;
            char weak[128], res[192];

            for (bi = 0; bi < MAX_MON_BLOWS; bi++)
                if (ap_ptr->blows[bi].method) blow_ct++;

            strnfmt(dbuf, sizeof(dbuf), "Lv %d | AC %d | Speed %s%d (%s)",
                    (int)ap_ptr->level, mon_ac(m_ptr), mspd >= 0 ? "+" : "", mspd, rel);
            web_hover_detail(stdout, &first_d, dbuf);

            strnfmt(dbuf, sizeof(dbuf), "EXP: %ld | Melee blows: %d%s",
                    (long)ap_ptr->mexp, blow_ct, m_ptr->hold_o_idx ? " | Carrying item" : "");
            web_hover_detail(stdout, &first_d, dbuf);

            weak[0] = '\0';
            if (ap_ptr->flags3 & RF3_HURT_FIRE) web_append_token(weak, sizeof(weak), "Fire");
            if (ap_ptr->flags3 & RF3_HURT_COLD) web_append_token(weak, sizeof(weak), "Cold");
            if (ap_ptr->flags3 & RF3_HURT_LITE) web_append_token(weak, sizeof(weak), "Light");
            if (ap_ptr->flags3 & RF3_HURT_ROCK) web_append_token(weak, sizeof(weak), "Rock Remover");
            if (weak[0])
            {
                strnfmt(dbuf, sizeof(dbuf), "Weak to: %s", weak);
                web_hover_detail(stdout, &first_d, dbuf);
            }

            res[0] = '\0';
            if (ap_ptr->flagsr & RFR_RES_ALL) web_append_token(res, sizeof(res), "All Elements");
            else
            {
                if (ap_ptr->flagsr & RFR_EFF_IM_ACID_MASK) web_append_token(res, sizeof(res), "Acid");
                if (ap_ptr->flagsr & RFR_EFF_IM_ELEC_MASK) web_append_token(res, sizeof(res), "Elec");
                if (ap_ptr->flagsr & RFR_EFF_IM_FIRE_MASK) web_append_token(res, sizeof(res), "Fire");
                if (ap_ptr->flagsr & RFR_EFF_IM_COLD_MASK) web_append_token(res, sizeof(res), "Cold");
                if (ap_ptr->flagsr & RFR_EFF_IM_POIS_MASK) web_append_token(res, sizeof(res), "Poison");
                if (ap_ptr->flagsr & RFR_RES_NETH) web_append_token(res, sizeof(res), "Nether");
                if (ap_ptr->flagsr & RFR_RES_CHAO) web_append_token(res, sizeof(res), "Chaos");
                if (ap_ptr->flagsr & RFR_RES_DISI) web_append_token(res, sizeof(res), "Disint");
                if (ap_ptr->flagsr & RFR_RES_TELE) web_append_token(res, sizeof(res), "Teleport");
            }
            if (res[0])
            {
                strnfmt(dbuf, sizeof(dbuf), "Resists: %s", res);
                web_hover_detail(stdout, &first_d, dbuf);
            }

            if (o_ptr)
            {
                char oname[96];
                object_desc(oname, o_ptr, 0);
                strnfmt(dbuf, sizeof(dbuf), "Item under: %s%s", oname,
                        pile_ct > 1 ? format(" (+%d more)", pile_ct - 1) : "");
                web_hover_detail(stdout, &first_d, dbuf);
            }
            else if (feat_name[0])
            {
                strnfmt(dbuf, sizeof(dbuf), "Tile: %s", feat_name);
                web_hover_detail(stdout, &first_d, dbuf);
            }
            web_hover_detail(stdout, &first_d, "Right-click: Inspect | Ctrl+Click: Lock Target");
        }
        else if (o_ptr)
        {
            int tot_w = (int)o_ptr->weight * MAX(1, (int)o_ptr->number);
            strnfmt(dbuf, sizeof(dbuf), "Weight: %d.%d lb%s",
                    tot_w / 10, tot_w % 10,
                    feat_name[0] ? format(" | Tile: %s", feat_name) : "");
            web_hover_detail(stdout, &first_d, dbuf);
            if (o_ptr->inscription)
            {
                strnfmt(dbuf, sizeof(dbuf), "Note: {%s}", quark_str(o_ptr->inscription));
                web_hover_detail(stdout, &first_d, dbuf);
            }
            web_hover_detail(stdout, &first_d, "Left-click: Travel here | Right-click: Look");
        }
        else if (f_ptr)
        {
            if (have_flag(f_ptr->flags, FF_STORE) || have_flag(f_ptr->flags, FF_BLDG))
                web_hover_detail(stdout, &first_d, "Walk onto entrance or press < to enter");
            else if (have_flag(f_ptr->flags, FF_STAIRS))
                web_hover_detail(stdout, &first_d, "Stand here and press < or > to change level");
            else if (have_flag(f_ptr->flags, FF_DOOR) && !have_flag(f_ptr->flags, FF_MOVE))
                web_hover_detail(stdout, &first_d, "Press o (Open) or move into door");
            else
                web_hover_detail(stdout, &first_d, "Left-click: Move / Travel | Right-click: Look");
        }
    }
    fputs("]}\n", stdout);
    fflush(stdout);
}

static void web_emit_player_flags(FILE *fp)
{
    bool first = TRUE;
    fputc('[', fp);
    #define EMIT_FLAG(COND, LABEL, KIND) \
        if (COND) { \
            if (!first) fputc(',', fp); \
            first = FALSE; \
            fprintf(fp, "{\"label\":\"%s\",\"kind\":\"%s\"}", LABEL, KIND); \
        }
    EMIT_FLAG(p_ptr->blind > 0, "Blind", "bad");
    EMIT_FLAG(p_ptr->confused > 0, "Confused", "bad");
    EMIT_FLAG(p_ptr->poisoned > 0, "Poisoned", "bad");
    EMIT_FLAG(p_ptr->cut > 0, "Bleeding", "bad");
    EMIT_FLAG(p_ptr->stun > 0, "Stunned", "bad");
    EMIT_FLAG(p_ptr->afraid > 0, "Afraid", "bad");
    EMIT_FLAG(p_ptr->paralyzed > 0, "Paralyzed", "bad");
    EMIT_FLAG(p_ptr->image > 0, "Halluc", "bad");
    EMIT_FLAG(p_ptr->slow > 0, "Slow", "bad");
    EMIT_FLAG(p_ptr->food < PY_FOOD_ALERT, "Hungry", "warn");
    EMIT_FLAG(p_ptr->fast > 0 || p_ptr->lightspeed > 0, "Haste", "good");
    EMIT_FLAG(p_ptr->hero > 0, "Hero", "good");
    EMIT_FLAG(p_ptr->shero > 0, "Berserk", "good");
    EMIT_FLAG(p_ptr->blessed > 0, "Blessed", "good");
    EMIT_FLAG(p_ptr->shield > 0, "Shield", "good");
    EMIT_FLAG(p_ptr->protevil > 0, "ProtEvil", "good");
    EMIT_FLAG(p_ptr->tim_esp > 0 || p_ptr->tim_esp_magical > 0, "ESP", "good");
    EMIT_FLAG(p_ptr->tim_invis > 0, "SeeInvis", "good");
    EMIT_FLAG(p_ptr->tim_regen > 0, "Regen", "good");
    EMIT_FLAG(p_ptr->invuln > 0, "Invuln", "good");
    EMIT_FLAG(p_ptr->oppose_fire > 0, "ResFire", "buff");
    EMIT_FLAG(p_ptr->oppose_cold > 0, "ResCold", "buff");
    EMIT_FLAG(p_ptr->oppose_acid > 0, "ResAcid", "buff");
    EMIT_FLAG(p_ptr->oppose_elec > 0, "ResElec", "buff");
    EMIT_FLAG(p_ptr->oppose_pois > 0, "ResPois", "buff");
    EMIT_FLAG(p_ptr->word_recall > 0, "Recall", "warn");
    EMIT_FLAG(p_ptr->action == ACTION_SEARCH, "Search", "info");
    EMIT_FLAG(p_ptr->action == ACTION_REST, "Resting", "info");
    #undef EMIT_FLAG
    fputc(']', fp);
}

static char web_classify_cell(int cy, int cx)
{
    cave_type *c_ptr;
    feature_type *f_ptr;
    int f_idx;

    if (!in_bounds(cy, cx)) return '0';
    c_ptr = &cave[cy][cx];
    if ((c_ptr->info & (CAVE_MARK | CAVE_VIEW | CAVE_AWARE)) == 0 && !p_ptr->inside_battle)
        return '0';

    f_idx = c_ptr->mimic ? c_ptr->mimic : c_ptr->feat;
    f_ptr = &f_info[f_idx];
    if (have_flag(f_ptr->flags, FF_SECRET) && f_ptr->mimic)
    {
        f_idx = f_ptr->mimic;
        f_ptr = &f_info[f_idx];
    }

    if (have_flag(f_ptr->flags, FF_STORE)) return 'S';
    if (have_flag(f_ptr->flags, FF_STAIRS))
    {
        if (have_flag(f_ptr->flags, FF_LESS)) return '<';
        return '>';
    }
    if (have_flag(f_ptr->flags, FF_DOOR))
    {
        if (have_flag(f_ptr->flags, FF_MOVE)) return 'd';
        return 'D';
    }
    if (have_flag(f_ptr->flags, FF_TREE)) return 'T';
    if (f_idx == 49 || (!have_flag(f_ptr->flags, FF_WALL) && have_flag(f_ptr->flags, FF_HURT_ROCK) && !have_flag(f_ptr->flags, FF_FLOOR)))
        return 'R';
    if (have_flag(f_ptr->flags, FF_WALL))
    {
        if (have_flag(f_ptr->flags, FF_PERMANENT))
            return 'P';
        if (f_idx == 54) return 'm';
        if (f_idx == 55) return 'q';
        if (f_idx == 50 || f_idx == 52)
            return have_flag(f_ptr->flags, FF_HAS_GOLD) ? 'm' : 'M';
        if (f_idx == 51 || f_idx == 53)
            return have_flag(f_ptr->flags, FF_HAS_GOLD) ? 'q' : 'Q';
        if (have_flag(f_ptr->flags, FF_HAS_GOLD) || have_flag(f_ptr->flags, FF_HAS_ITEM))
            return 'm';
        return 'W';
    }
    if (have_flag(f_ptr->flags, FF_LAVA)) return 'L';
    if (have_flag(f_ptr->flags, FF_WATER))
    {
        if (have_flag(f_ptr->flags, FF_DEEP)) return 'w';
        return '~';
    }
    if (have_flag(f_ptr->flags, FF_TRAP)) return '^';
    if (have_flag(f_ptr->flags, FF_PLANT)) return 'g';
    return 'G';
}

static void web_extract_row0(char *out, int out_sz)
{
    term *t = &web_terms[0].t;
    int x, lim, last = -1;
    out[0] = '\0';
    if (!t->scr) return;
    lim = MIN((int)t->wid, out_sz - 1);
    for (x = 0; x < lim; x++)
    {
        unsigned char c = (unsigned char)t->scr->c[0][x];
        char ch = (c >= 32 && c < 127) ? (char)c : ' ';
        out[x] = ch;
        if (ch != ' ') last = x;
    }
    out[last + 1] = '\0';
}

static cptr web_detect_prompt_kind(cptr row0)
{
    if (!character_generated) return "birth";
    if (character_dungeon && !character_icky && inkey_flag) return "none";
    if (mouse_context == MOUSE_CTX_TARGET) return "target";
    if (row0 && (strstr(row0, "-more-") || strstr(row0, "--More--"))) return "more";
    if (row0 && (strstr(row0, "[y/n]") || strstr(row0, "[Y/n]") || strstr(row0, "[n/Y]") || strstr(row0, "[y/N]") || strstr(row0, "Are you sure")))
        return "yn";
    if (row0 && (strstr(row0, "Direction") || strstr(row0, "direction")))
        return "dir";
    if (character_icky || mouse_context == MOUSE_CTX_MENU || mouse_context == MOUSE_CTX_SHOP || mouse_context == MOUSE_CTX_INVENTORY)
        return "menu";
    if (row0 && strchr(row0, ':')) return "input";
    return "prompt";
}

static void web_emit_state(FILE *fp)
{
    cptr graf_name = web_graf_mode ? web_graf_mode : "ascii";
    char row0[160];
    cptr pkind;
    bool busy = (running || travel.run || command_rep || (character_generated && p_ptr->action == ACTION_REST));

    web_extract_row0(row0, sizeof(row0));
    pkind = web_detect_prompt_kind(row0);

    fprintf(fp, "{\"gen\":%s,\"dungeon\":%s,\"icky\":%s,\"cmdReady\":%s,\"canSave\":%s,\"busy\":%s,\"ctx\":%d,\"promptKind\":",
            character_generated ? "true" : "false",
            character_dungeon ? "true" : "false",
            character_icky ? "true" : "false",
            inkey_flag ? "true" : "false",
            (can_save && !character_icky) ? "true" : "false",
            busy ? "true" : "false",
            (int)mouse_context);
    web_json_str(fp, pkind);
    fputs(",\"promptText\":", fp);
    web_json_str(fp, row0);
    fputs(",\"graf\":", fp);
    web_json_str(fp, graf_name);

    if (character_generated)
    {
        s32b cur_req = (p_ptr->lev > 1) ? exp_requirement(p_ptr->lev - 1) : 0;
        s32b next_req = (p_ptr->lev < PY_MAX_LEVEL) ? exp_requirement(p_ptr->lev) : p_ptr->exp;
        int spd = p_ptr->pspeed - 110;
        int i;

        fputs(",\"player\":{\"name\":", fp);
        web_json_str(fp, player_name[0] ? player_name : "Adventurer");
        fputs(",\"race\":", fp);
        web_json_str(fp, get_race()->name);
        fputs(",\"class\":", fp);
        web_json_str(fp, get_class()->name);
        fputs(",\"pers\":", fp);
        web_json_str(fp, get_personality()->name);
        fputs(",\"r1\":", fp);
        web_json_str(fp, p_ptr->realm1 ? realm_names[p_ptr->realm1] : "");
        fputs(",\"r2\":", fp);
        web_json_str(fp, p_ptr->realm2 ? realm_names[p_ptr->realm2] : "");
        fprintf(fp, ",\"lev\":%d,\"exp\":%ld,\"maxExp\":%ld,\"curReq\":%ld,\"nextReq\":%ld",
                (int)p_ptr->lev, (long)p_ptr->exp, (long)p_ptr->max_exp,
                (long)cur_req, (long)next_req);
        fprintf(fp, ",\"au\":%ld,\"turn\":%ld,\"chp\":%ld,\"mhp\":%ld,\"csp\":%ld,\"msp\":%ld",
                (long)p_ptr->au, (long)game_turn, (long)p_ptr->chp, (long)p_ptr->mhp,
                (long)p_ptr->csp, (long)p_ptr->msp);
        fprintf(fp, ",\"ac\":%d,\"spd\":%d,\"depth\":%d,\"wild\":%s,\"food\":%d,\"lite\":%d,\"px\":%d,\"py\":%d,\"prace\":%d,\"pclass\":%d,\"mimic\":%d",
                (int)(p_ptr->dis_ac + p_ptr->dis_to_a), spd, (int)dun_level,
                p_ptr->wild_mode ? "true" : "false",
                (int)p_ptr->food, (int)p_ptr->cur_lite, (int)px, (int)py,
                (int)p_ptr->prace, (int)p_ptr->pclass, (int)p_ptr->mimic_form);

        fputs(",\"stats\":[", fp);
        for (i = 0; i < 6; i++)
        {
            if (i > 0) fputc(',', fp);
            fprintf(fp, "%d", (int)p_ptr->stat_use[i]);
        }
        fputs("],\"flags\":", fp);
        web_emit_player_flags(fp);

        /* Target info */
        if (target_who > 0 && m_list[target_who].r_idx)
        {
            monster_type *tm = &m_list[target_who];
            char tname[128];
            int hp_pct = tm->maxhp > 0 ? (int)((100L * MAX(0, tm->hp)) / tm->maxhp) : 100;
            monster_desc(tname, tm, MD_IGNORE_HALLU | MD_ASSUME_VISIBLE);
            fputs(",\"target\":{\"name\":", fp);
            web_json_str(fp, tname);
            fprintf(fp, ",\"hp\":%d,\"x\":%d,\"y\":%d}", hp_pct, (int)tm->fx, (int)tm->fy);
        }
        else if (target_row && target_col)
        {
            fprintf(fp, ",\"target\":{\"name\":\"Target Grid\",\"hp\":-1,\"x\":%d,\"y\":%d}",
                    (int)target_col, (int)target_row);
        }
        fputc('}', fp);

        /* Pack items */
        fputs(",\"inven\":[", fp);
        {
            int max_s = pack_max();
            bool first_item = TRUE;
            slot_t s;
            for (s = 1; s <= max_s; s++)
            {
                obj_ptr o = pack_obj(s);
                char desc[160];
                if (!o) continue;
                object_desc(desc, o, 0);
                if (!first_item) fputc(',', fp);
                first_item = FALSE;
                fprintf(fp, "{\"slot\":%d,\"lbl\":\"%c\",\"tval\":%d,\"num\":%d,\"wgt\":%d,\"name\":",
                        (int)s, slot_label(s), (int)o->tval, (int)o->number, (int)o->weight);
                web_json_str(fp, desc);
                fputc('}', fp);
            }
        }
        fputc(']', fp);

        /* Equipment items */
        fputs(",\"equip\":[", fp);
        {
            int max_e = equip_max();
            bool first_eq = TRUE;
            slot_t s;
            for (s = 1; s <= max_e; s++)
            {
                obj_ptr o = equip_obj(s);
                char desc[160];
                cptr sname = equip_describe_slot(s);
                if (!first_eq) fputc(',', fp);
                first_eq = FALSE;
                if (o)
                    object_desc(desc, o, 0);
                else
                    my_strcpy(desc, "(empty)", sizeof(desc));
                fprintf(fp, "{\"slot\":%d,\"lbl\":\"%c\",\"empty\":%s,\"slotName\":",
                        (int)s, slot_label(s), o ? "false" : "true");
                web_json_str(fp, sname ? sname : "Slot");
                fputs(",\"name\":", fp);
                web_json_str(fp, desc);
                fputc('}', fp);
            }
        }
        fputc(']', fp);
    }

    /* Map viewport metadata */
    if (character_dungeon)
    {
        rect_t mr = ui_map_rect();
        fprintf(fp, ",\"mapRect\":{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d},\"vp\":{\"x\":%d,\"y\":%d}",
                mr.x, mr.y, mr.cx, mr.cy, viewport_origin.x, viewport_origin.y);

        if (!character_icky)
        {
            int ux, uy;
            bool first_mon = TRUE;
            bool first_obj = TRUE;
            fputs(",\"los\":\"", fp);
            for (uy = mr.y; uy < mr.y + mr.cy; uy++)
            {
                for (ux = mr.x; ux < mr.x + mr.cx; ux++)
                {
                    point_t cp = ui_pt_to_cave_pt(point(ux, uy));
                    char ch = '0';
                    if (in_bounds(cp.y, cp.x))
                    {
                        u32b info = cave[cp.y][cp.x].info;
                        bool in_view = ((info & CAVE_VIEW) != 0) || p_ptr->inside_battle;
                        bool in_lite = (info & CAVE_LITE) != 0;
                        bool marked = (info & (CAVE_MARK | CAVE_AWARE)) != 0;
                        if (in_view && in_lite) ch = '4';
                        else if (in_view) ch = '3';
                        else if (marked && in_lite) ch = '2';
                        else if (marked) ch = '1';
                    }
                    fputc(ch, fp);
                }
            }
            fputs("\",\"cells\":\"", fp);
            for (uy = mr.y; uy < mr.y + mr.cy; uy++)
            {
                for (ux = mr.x; ux < mr.x + mr.cx; ux++)
                {
                    point_t cp = ui_pt_to_cave_pt(point(ux, uy));
                    fputc(web_classify_cell(cp.y, cp.x), fp);
                }
            }
            fputs("\",\"objs\":[", fp);
            for (uy = mr.y; uy < mr.y + mr.cy; uy++)
            {
                for (ux = mr.x; ux < mr.x + mr.cx; ux++)
                {
                    point_t cp = ui_pt_to_cave_pt(point(ux, uy));
                    if (!in_bounds(cp.y, cp.x)) continue;
                    if (cave[cp.y][cp.x].o_idx > 0 &&
                        ((cave[cp.y][cp.x].info & (CAVE_MARK | CAVE_VIEW)) != 0 || p_ptr->inside_battle))
                    {
                        object_type *o_ptr = &o_list[cave[cp.y][cp.x].o_idx];
                        if (o_ptr->marked & OM_FOUND)
                        {
                            object_kind *k_ptr = &k_info[o_ptr->k_idx];
                            char oname[128];
                            object_desc(oname, o_ptr, 0);
                            if (!first_obj) fputc(',', fp);
                            first_obj = FALSE;
                            fprintf(fp, "[%d,%d,%d,%d,%d,%d,%d,%d,",
                                    ux, uy, (int)o_ptr->tval, (int)o_ptr->sval, (int)o_ptr->k_idx,
                                    (int)k_ptr->d_attr, (int)k_ptr->x_attr, (int)(unsigned char)k_ptr->x_char);
                            web_json_str(fp, oname);
                            fputc(']', fp);
                        }
                    }
                }
            }
            fputs("],\"mons\":[", fp);
            for (uy = mr.y; uy < mr.y + mr.cy; uy++)
            {
                for (ux = mr.x; ux < mr.x + mr.cx; ux++)
                {
                    point_t cp = ui_pt_to_cave_pt(point(ux, uy));
                    if (!in_bounds(cp.y, cp.x)) continue;
                    if (cave[cp.y][cp.x].m_idx > 0)
                    {
                        monster_type *m_ptr = &m_list[cave[cp.y][cp.x].m_idx];
                        if (m_ptr->ml)
                        {
                            monster_race *r_ptr = &r_info[m_ptr->ap_r_idx ? m_ptr->ap_r_idx : m_ptr->r_idx];
                            char mname[128];
                            int hp_pct = (m_ptr->maxhp > 0) ? (int)((100L * MAX(0, m_ptr->hp)) / m_ptr->maxhp) : 100;
                            int att = is_pet(m_ptr) ? 2 : (is_friendly(m_ptr) ? 1 : 0);
                            int uniq = (r_ptr->flags1 & RF1_UNIQUE) ? 1 : 0;
                            int ridx = (int)(m_ptr->ap_r_idx ? m_ptr->ap_r_idx : m_ptr->r_idx);
                            monster_desc(mname, m_ptr, MD_IGNORE_HALLU | MD_ASSUME_VISIBLE);
                            if (!first_mon) fputc(',', fp);
                            first_mon = FALSE;
                            fprintf(fp, "[%d,%d,%d,%d,%d,%d,",
                                    ux, uy, hp_pct, att, MON_CSLEEP(m_ptr) ? 1 : 0, uniq);
                            web_json_str(fp, mname);
                            fprintf(fp, ",%d,%d,%d,%d,%d]",
                                    (int)(unsigned char)r_ptr->d_char, ridx,
                                    (int)r_ptr->d_attr, (int)r_ptr->x_attr, (int)(unsigned char)r_ptr->x_char);
                        }
                    }
                }
            }
            fputc(']', fp);
        }
    }

    /* Recent messages */
    {
        int cnt = msg_count();
        int lim = MIN(cnt, 36);
        int age;
        fputs(",\"msgs\":[", fp);
        for (age = lim - 1; age >= 0; age--)
        {
            msg_ptr mp = msg_get(age);
            char buf[512];
            if (!mp) continue;
            msg_get_plain_text(age, buf, sizeof(buf));
            if (age < lim - 1) fputc(',', fp);
            fprintf(fp, "{\"c\":%d,\"n\":%d,\"t\":%d,\"s\":",
                    (int)mp->color, mp->count, mp->turn);
            web_json_str(fp, buf);
            fputc('}', fp);
        }
        fputc(']', fp);
    }

    fputc('}', fp);
}

static void web_emit_frame(bool force_state)
{
    web_term_data *td = &web_terms[0];
    term *t = &td->t;
    int w, h, y, x;
    int dirty_rows[WEB_MAX_H];
    int dirty_ct = 0;
    bool full;
    bool cursor_changed;

    if (!web_initialized || !t->scr) return;

    w = MIN((int)t->wid, WEB_MAX_W);
    h = MIN((int)t->hgt, WEB_MAX_H);
    full = td->force_full || (w != td->prev_w) || (h != td->prev_h);

    for (y = 0; y < h; y++)
    {
        bool row_dirty = full;
        if (!row_dirty)
        {
            for (x = 0; x < w; x++)
            {
                if (td->prev_a[y][x] != t->scr->a[y][x] ||
                    td->prev_c[y][x] != t->scr->c[y][x] ||
                    td->prev_ta[y][x] != t->scr->ta[y][x] ||
                    td->prev_tc[y][x] != t->scr->tc[y][x])
                {
                    row_dirty = TRUE;
                    break;
                }
            }
        }
        if (row_dirty)
            dirty_rows[dirty_ct++] = y;
    }

    cursor_changed = (td->prev_cx != (int)t->scr->cx) ||
                     (td->prev_cy != (int)t->scr->cy) ||
                     (td->prev_cv != (bool)t->scr->cv);

    if (!full && dirty_ct == 0 && !cursor_changed && sound_queue_len == 0 && !force_state)
        return;

    fprintf(stdout, "{\"type\":\"frame\",\"w\":%d,\"h\":%d,\"cx\":%d,\"cy\":%d,\"cv\":%s,\"full\":%s,\"dirty\":[",
            w, h, (int)t->scr->cx, (int)t->scr->cy,
            t->scr->cv ? "true" : "false",
            full ? "true" : "false");

    for (y = 0; y < dirty_ct; y++)
    {
        int ry = dirty_rows[y];
        if (y > 0) fputc(',', stdout);
        fprintf(stdout, "[%d", ry);
        for (x = 0; x < w; x++)
        {
            byte a = t->scr->a[ry][x];
            unsigned char c = (unsigned char)t->scr->c[ry][x];
            byte ta = t->scr->ta[ry][x];
            unsigned char tc = (unsigned char)t->scr->tc[ry][x];
            fprintf(stdout, ",%d,%d,%d,%d", (int)a, (int)c, (int)ta, (int)tc);

            td->prev_a[ry][x] = a;
            td->prev_c[ry][x] = (char)c;
            td->prev_ta[ry][x] = ta;
            td->prev_tc[ry][x] = (char)tc;
        }
        fputc(']', stdout);
    }
    fputc(']', stdout);

    if (sound_queue_len > 0)
    {
        int i;
        fputs(",\"sounds\":[", stdout);
        for (i = 0; i < sound_queue_len; i++)
        {
            if (i > 0) fputc(',', stdout);
            fprintf(stdout, "%d", sound_queue[i]);
        }
        fputc(']', stdout);
        sound_queue_len = 0;
    }

    fputs(",\"state\":", stdout);
    web_emit_state(stdout);
    fputs("}\n", stdout);
    fflush(stdout);

    td->prev_w = w;
    td->prev_h = h;
    td->prev_cx = (int)t->scr->cx;
    td->prev_cy = (int)t->scr->cy;
    td->prev_cv = (bool)t->scr->cv;
    td->force_full = FALSE;
}

static void Term_init_web(term *t)
{
    (void)t;
}

static void Term_nuke_web(term *t)
{
    (void)t;
}

static errr Term_xtra_web(int n, int v)
{
    switch (n)
    {
    case TERM_XTRA_EVENT:
        if (v)
            web_emit_frame(TRUE);
        web_poll_input(v != 0);
        return 0;

    case TERM_XTRA_FLUSH:
        web_poll_input(FALSE);
        return 0;

    case TERM_XTRA_CLEAR:
        web_terms[0].force_full = TRUE;
        return 0;

    case TERM_XTRA_FRESH:
        web_emit_frame(FALSE);
        return 0;

    case TERM_XTRA_NOISE:
        web_queue_sound(0);
        return 0;

    case TERM_XTRA_SOUND:
        if (use_sound)
            web_queue_sound(v);
        return 0;

    case TERM_XTRA_DELAY:
        if (v > 0)
        {
            web_emit_frame(FALSE);
            web_poll_input(FALSE);
#ifdef WINDOWS
            Sleep((DWORD)v);
#else
            usleep((useconds_t)v * 1000);
#endif
        }
        return 0;

    case TERM_XTRA_BORED:
    case TERM_XTRA_SHAPE:
    case TERM_XTRA_FROSH:
    case TERM_XTRA_REACT:
    case TERM_XTRA_ALIVE:
    case TERM_XTRA_LEVEL:
        return 0;
    }
    return 1;
}

static errr Term_curs_web(int x, int y)
{
    (void)x;
    (void)y;
    return 0;
}

static errr Term_wipe_web(int x, int y, int n)
{
    (void)x;
    (void)y;
    (void)n;
    return 0;
}

static errr Term_text_web(int x, int y, int n, byte a, const char *s)
{
    (void)x;
    (void)y;
    (void)n;
    (void)a;
    (void)s;
    return 0;
}

static errr Term_pict_web(int x, int y, int n, const byte *ap, const char *cp, const byte *tap, const char *tcp)
{
    (void)x;
    (void)y;
    (void)n;
    (void)ap;
    (void)cp;
    (void)tap;
    (void)tcp;
    return 0;
}

static void web_init_paths(cptr explicit_lib)
{
    char path[1024];

    if (explicit_lib && *explicit_lib)
    {
        my_strcpy(path, explicit_lib, sizeof(path));
        if (!suffix(path, PATH_SEP))
            my_strcat(path, PATH_SEP, sizeof(path));
        init_file_paths(path, path, path);
        return;
    }

#ifdef WINDOWS
    {
        char exe[1024];
        int i;
        DWORD len = GetModuleFileNameA(NULL, exe, sizeof(exe) - 1);
        exe[len] = '\0';
        for (i = (int)strlen(exe) - 1; i >= 0; i--)
        {
            if (exe[i] == '\\' || exe[i] == '/')
            {
                exe[i + 1] = '\0';
                break;
            }
        }
        sprintf(path, "%slib\\", exe);
        if (GetFileAttributesA(path) == INVALID_FILE_ATTRIBUTES)
        {
            sprintf(path, "%s..\\lib\\", exe);
        }
        init_file_paths(path, path, path);
    }
#else
    my_strcpy(path, DEFAULT_LIB_PATH, sizeof(path));
    if (!suffix(path, PATH_SEP))
        my_strcat(path, PATH_SEP, sizeof(path));
    init_file_paths(path, path, path);
#endif
}

static void web_quit_hook(cptr s)
{
    if (web_initialized && character_dungeon)
        clear_saved_floor_files();
    if (s && *s)
    {
        fprintf(stdout, "{\"type\":\"error\",\"msg\":");
        web_json_str(stdout, s);
        fputs("}\n", stdout);
        fflush(stdout);
    }
    else
    {
        fprintf(stdout, "{\"type\":\"quit\"}\n");
        fflush(stdout);
    }
    if (angband_term[0])
        term_nuke(angband_term[0]);
}

static void web_emit_init(int cols, int rows)
{
    int i;
    fprintf(stdout, "{\"type\":\"init\",\"cols\":%d,\"rows\":%d,\"graf\":", cols, rows);
    web_json_str(stdout, ANGBAND_GRAF ? ANGBAND_GRAF : "proc32");
    fputs(",\"colors\":[", stdout);
    for (i = 0; i < 256; i++)
    {
        if (i > 0) fputc(',', stdout);
        fprintf(stdout, "[%d,%d,%d]",
                (int)angband_color_table[i][1],
                (int)angband_color_table[i][2],
                (int)angband_color_table[i][3]);
    }
    fputs("]}\n", stdout);
    fflush(stdout);
}

int main(int argc, char *argv[])
{
    int i;
    int cols = WEB_DEF_W;
    int rows = WEB_DEF_H;
    bool new_game = FALSE;
    cptr explicit_lib = NULL;
    cptr graf_mode = "overhaul";
    term *t;

#ifdef WINDOWS
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    setvbuf(stdout, NULL, _IOFBF, 65536);

    ANGBAND_SYS = "web";
    ANGBAND_KEYBOARD = "0";
    use_sound = TRUE;
    arg_sound = TRUE;
    use_mouse = TRUE;
    mouse_movement = TRUE;
    mouse_tooltips = TRUE;
    mouse_hover_highlight = TRUE;

    for (i = 1; i < argc; i++)
    {
        cptr arg = argv[i];
        if (streq(arg, "-n"))
            new_game = TRUE;
        else if (streq(arg, "-w"))
            arg_wizard = TRUE;
        else if (streq(arg, "-f"))
            arg_fiddle = TRUE;
        else if (prefix(arg, "-u"))
            my_strcpy(player_name, arg + 2, sizeof(player_name));
        else if (prefix(arg, "--cols="))
            cols = atoi(arg + 7);
        else if (prefix(arg, "--rows="))
            rows = atoi(arg + 7);
        else if (prefix(arg, "--lib="))
            explicit_lib = arg + 6;
        else if (prefix(arg, "--graf="))
            graf_mode = arg + 7;
    }

    if (cols < 80) cols = 80;
    if (cols > WEB_MAX_W) cols = WEB_MAX_W;
    if (rows < 24) rows = 24;
    if (rows > WEB_MAX_H) rows = WEB_MAX_H;

    web_init_paths(explicit_lib);
    process_player_name(TRUE);
    create_needed_dirs();

    quit_aux = web_quit_hook;

    memset(&web_terms[0], 0, sizeof(web_terms[0]));
    web_terms[0].w = cols;
    web_terms[0].h = rows;
    web_terms[0].force_full = TRUE;

    t = &web_terms[0].t;
    term_init(t, cols, rows, 256);
    t->soft_cursor = TRUE;
    t->icky_corner = FALSE;
    t->attr_blank = TERM_WHITE;
    t->char_blank = ' ';
    t->init_hook = Term_init_web;
    t->nuke_hook = Term_nuke_web;
    t->xtra_hook = Term_xtra_web;
    t->curs_hook = Term_curs_web;
    t->wipe_hook = Term_wipe_web;
    t->text_hook = Term_text_web;
    t->pict_hook = Term_pict_web;
    t->data = &web_terms[0];

    angband_term[0] = t;
    Term_activate(t);

    if (streq(graf_mode, "none") || streq(graf_mode, "ascii"))
    {
        use_graphics = GRAPHICS_NONE;
        arg_graphics = GRAPHICS_NONE;
        ANGBAND_GRAF = "ascii";
        web_graf_mode = "ascii";
    }
    else if (streq(graf_mode, "proc32"))
    {
        use_graphics = GRAPHICS_ADAM_BOLT;
        arg_graphics = GRAPHICS_ADAM_BOLT;
        ANGBAND_GRAF = "proc32";
        web_graf_mode = "proc32";
    }
    else if (streq(graf_mode, "new") || streq(graf_mode, "16x16"))
    {
        use_graphics = GRAPHICS_ADAM_BOLT;
        arg_graphics = GRAPHICS_ADAM_BOLT;
        ANGBAND_GRAF = "new";
        web_graf_mode = "new";
    }
    else if (streq(graf_mode, "old") || streq(graf_mode, "8x8"))
    {
        use_graphics = GRAPHICS_ORIGINAL;
        arg_graphics = GRAPHICS_ORIGINAL;
        ANGBAND_GRAF = "old";
        web_graf_mode = "old";
    }
    else
    {
        use_graphics = GRAPHICS_ADAM_BOLT;
        arg_graphics = GRAPHICS_ADAM_BOLT;
        ANGBAND_GRAF = "new";
        web_graf_mode = "overhaul";
    }
    t->higher_pict = (use_graphics != GRAPHICS_NONE);

    signals_init();
    init_angband();

    web_initialized = TRUE;
    web_emit_init(cols, rows);
    web_emit_frame(TRUE);

    play_game(new_game);

    quit(NULL);
    return 0;
}

#endif /* USE_WEB */
