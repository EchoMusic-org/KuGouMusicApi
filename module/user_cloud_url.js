// 获取云盘音质播放url
// 流程（真机抓包还原）：
// 1. get_res_privilege（media.store.kugou.com）获取歌曲全部音质列表（128/320/flac/high/dolby）
// 2. 选中音质的 hash 调本接口获取播放地址（bucket=musicclound）
// 注意：该接口对请求头敏感，必须使用 CloudMusic 后缀的 UA 且不能带 dfid/mid 等多余头，因此不走 useAxios
const axios = require('axios');
const { signCloudKey, clientver, appid: useAppid } = require('../util');
const { resolveProxy } = require('../util/runtime');

module.exports = (params, useAxios) => {
  const answer = { status: 500, body: {}, cookie: [] };
  return new Promise(async (resolve) => {
    try {
      const hash = String(params.hash).toLowerCase();
      const userid = params?.userid || params?.cookie?.userid || 0;
      const token = params?.token || params?.cookie?.token || '';

      const paramsMap = {
        album_audio_id: params.album_audio_id ?? 0,
        name: params.name ?? '',
        bucket: 'musicclound',
        token,
        audio_id: params.audio_id ?? 0,
        hash,
        userid,
        pid: 20026,
        version: params.version ?? clientver,
        appid: params.appid ?? useAppid,
        key: signCloudKey(hash, 20026),
        ssa_flag: 'is_fromtrack',
        with_res_tag: 1,
      };

      const proxyConfig = resolveProxy();
      const response = await axios({
        method: 'get',
        baseURL: 'http://bsstrackercdngz.kugou.com',
        url: '/query/download/url/musicclound',
        params: paramsMap,
        headers: {
          'User-Agent': 'Android15-1070-10672-201-0-CloudMusic-wifi',
          'KG-RC': '1',
          'KG-Rec': '1',
          'KG-THash': Math.floor(Math.random() * 0xfffffff)
            .toString(16)
            .padStart(7, '0'),
        },
        ...(proxyConfig ? { proxy: proxyConfig } : {}),
      });

      // 响应带有 <!--KG_TAG_RES_START--> 与 <!--KG_TAG_RES_END--> 包装标记，需剥离后解析
      let body = response.data;
      if (typeof body === 'string') {
        const text = body.replace(/<!--KG_TAG_RES_START-->|<!--KG_TAG_RES_END-->/g, '').trim();
        try {
          body = JSON.parse(text);
        } catch (e) {
          body = { status: 0, error_code: -1, data: text };
        }
      }

      answer.status = body.status === 1 ? 200 : 502;
      answer.body = body;
      resolve(answer);
    } catch (error) {
      console.log(error);
      answer.body = { status: 0, error_code: -1, msg: error?.message || String(error) };
      resolve(answer);
    }
  });
};
