// 获取歌曲信息（含云盘音质）
// 登录状态下自动查询用户云盘，若歌曲在云盘有匹配文件（结构化匹配"歌手 - 歌名"），
// 则向 relate_goods 追加云盘音质条目（quality: 'cloud'）
const { appid, clientver } = require('../util');
const getUserCloud = require('./user_cloud');

// 云盘文件名支持的音乐扩展名白名单
const CLOUD_EXT_RE = /\.(mp3|flac|m4a|ape|wav|aac|ogg|wma|alac|dsf|dff)$/i;

// 追加云盘音质到 relate_goods（失败静默，不影响原始响应）
const appendCloudQuality = async (respone, params, useAxios) => {
  const data = respone?.body?.data;
  const song = Array.isArray(data) ? data[0] : null;
  const goods = song?.relate_goods;
  if (!Array.isArray(goods) || !song?.name) return;

  // 登录态检测：需携带 userid 与 token 才查询云盘
  const userid = params?.userid || params?.cookie?.userid;
  const token = params?.token || params?.cookie?.token;
  if (!userid || !token) return;

  // 分页拉取云盘列表（默认最多 5 页 × 60 条），匹配到即提前返回
  const maxPages = Number(params?.cloud_pages ?? 5);
  const pagesize = Number(params?.cloud_pagesize ?? 60);
  let file = null;
  for (let page = 1; page <= maxPages; page++) {
    const cloud = await getUserCloud({ page, pagesize, cookie: params?.cookie }, useAxios);
    const items = cloud?.body?.data?.list || [];
    if (!items.length) break;
    file = matchCloudFile(items, song);
    if (file) break;
  }
  // 无匹配文件时不追加云盘音质
  if (!file) return;
  // 去重：已存在 quality='cloud' 的条目则跳过（云盘文件 hash 可能与曲库某音质 hash 相同，不以此去重）
  if (goods.some((g) => g.quality === 'cloud')) {
    return;
  }

  goods.push({
    hash: file.hash,
    quality: 'cloud',
    level: 8,
    ext: file.ext,
    name: file.name,
    filesize: file.size,
  });
};

// 结构化匹配：云盘文件与歌曲对比
// - 精确：文件名去扩展名 == song.name（忽略大小写/空格/标点）
// - 结构化：解析"歌手 - 歌名"，歌手精确匹配 + 歌名词级模糊匹配（容忍 U/You 等细微差异）
// - 兜底：歌曲无歌手信息，仅歌名匹配
const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
};

// 词级相似度：两标题按空格分词，匹配词占比 >= 60% 视为相似（容忍 U/You 等小差异）
const wordsSimilar = (a, b) => {
  const wa = String(a).toLowerCase().split(/\s+/).filter(Boolean);
  const wb = String(b).toLowerCase().split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return false;
  const hit = wa.filter((w1) => wb.some((w2) => w2 === w1 || levenshtein(w1, w2) <= 2)).length;
  return hit / wa.length >= 0.6;
};

const matchCloudFile = (list, song) => {
  const songName = String(song.name || '').trim();
  const singer = String(song.singername || '').trim();
  const sep = songName.lastIndexOf(' - ');
  const songTitle = (sep > 0 ? songName.slice(sep + 3) : songName).trim();

  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[\s_\-·.，,（）()]+/g, '');
  const normSongName = norm(songName);
  const normSinger = norm(singer);
  const normSongTitle = norm(songTitle);

  for (const file of list) {
    const raw = String(file.name || '').trim();
    const base = raw.replace(CLOUD_EXT_RE, '').trim();
    if (!base) continue;

    // 精确匹配：文件名（去扩展名）== song.name
    if (norm(base) === normSongName) return file;

    // 结构化匹配：解析"歌手 - 歌名"
    const rawSinger = String(file.author_name || '').trim();
    const fSinger = rawSinger || (base.includes(' - ') ? base.split(' - ')[0].trim() : '');
    let fTitle = '';
    if (fSinger && norm(base).startsWith(norm(fSinger))) {
      fTitle = base
        .slice(fSinger.length)
        .replace(/^[\s\-]+/, '')
        .trim();
    } else if (base.includes(' - ')) {
      fTitle = base.slice(base.lastIndexOf(' - ') + 3).trim();
    }
    if (!fTitle) continue;

    // 歌手匹配（歌曲有歌手时需精确一致）
    if (normSinger && norm(fSinger) !== normSinger) continue;

    // 歌名相似：相等 / 互相包含 / 词级模糊匹配
    const a = norm(fTitle);
    const b = normSongTitle;
    if (a === b || a.includes(b) || b.includes(a) || wordsSimilar(fTitle, songTitle)) {
      return file;
    }
  }
  return null;
};

module.exports = (params, useAxios) => {
  const resource = (params?.hash || '').split(',').map((s) => ({ type: 'audio', page_id: 0, hash: s, album_id: 0 }));
  (params?.album_id || '').split(',').forEach((s, l) => (resource[l]['album_id'] = s));

  const dataMap = {
    appid,
    area_code: 1,
    behavior: 'play',
    clientver,
    need_hash_offset: 1,
    relate: 1,
    support_verify: 1,
    resource,
    qualities: ['128', '320', 'flac', 'high', 'viper_atmos', 'viper_tape', 'viper_clear', 'super', 'multitrack'],
  };

  return useAxios({
    url: '/v2/get_res_privilege/lite',
    data: dataMap,
    method: 'post',
    encryptType: 'android',
    cookie: params?.cookie || {},
    headers: { 'x-router': 'media.store.kugou.com', 'Content-Type': 'application/json' },
  }).then(async (respone) => {
    // 云盘音质追加失败不影响原始响应
    try {
      await appendCloudQuality(respone, params, useAxios);
    } catch (error) {
      console.log(error);
    }
    return respone;
  });
};
