const TIPS = [
  {
    title: '網址真網域一定喺「最後」',
    body: '詐騙集團會將真品牌名塞入子網域：my.7-11.com.bsrtd.top 嘅真網域係 bsrtd.top，唔係 7-11！真 7-11 賣貨便一定係 myship.7-11.com.tw 結尾。睇網址要由後面睇返轉頭。',
    example: '❌ my.7-11.com.bsrtd.top　✅ myship.7-11.com.tw',
  },
  {
    title: '「未認證」官方帳號＋催單＝高危',
    body: 'LINE/IG/FB 賣家如果係未認證帳號、好友人數少、又不斷催你「今日截單」「最後幾件」，九成係假。正經舖唔會催你。',
  },
  {
    title: '拒絕私下交易',
    body: '任何叫你「私訊下單」「直接轉數/匯款」「加 LINE 傾」嘅，一律當詐騙處理。用有第三方保障嘅平台（蝦皮、HKTVmall、舖頭自己網店）先好過數。',
  },
  {
    title: '「到店取貨先付款」都可以係餌',
    body: '假賣貨便連結話你唔使先付款，目的係呃你填個人資料同信用卡；之後仲會有「客服」打嚟叫你去 ATM「解除設定」——嗰下先係真正落刀。',
  },
  {
    title: '平得離譜就係假',
    body: '熱門 UX 款長期缺貨，有人開遠低於市價嘅「現貨」，唔係假貨就係收咗錢唔發貨。用本站跨區比價功能睇吓合理價位先。',
  },
];

export default function SafetyPage() {
  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold">🛡️ 防詐指南</h2>
      <p className="mt-1 text-sm text-white/50">
        本站防詐引擎會自動掃描情報入面嘅連結同字眼，發現可疑會標 ⚠️。但最好嘅防線係你自己——記住以下幾條。
      </p>
      <div className="mt-5 space-y-4">
        {TIPS.map((t, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-navy-800 p-4">
            <h3 className="font-bold text-bey-yellow">{i + 1}. {t.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-white/80">{t.body}</p>
            {t.example && <p className="mt-2 rounded bg-black/30 px-3 py-2 font-mono text-xs">{t.example}</p>}
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-white/50">
        懷疑受騙：香港打 <b className="text-white">18222</b>（防騙易）；台灣打 <b className="text-white">165</b>。
      </p>
    </div>
  );
}
