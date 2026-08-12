import { describe, expect, it } from 'vitest';
import { AkisCozucu, aracMetni } from './akis';

/**
 * ⚠️ BU TESTİN ASIL DERDİ "ÇERÇEVE PARÇA SINIRINDA BÖLÜNÜRSE NE OLUR".
 *    Ağ katmanı isteğe bağlı yerlerden böler ve bölünme UZUN yanıtlarda
 *    görünür; elle denemede kısa cevaplar tek parçada geldiği için arıza hiç
 *    çıkmaz. Deponun "derleniyor ≠ çalışıyor" hatasının SSE karşılığı tam
 *    olarak burada.
 */
describe('AkisCozucu', () => {
  it('tek parçadaki çerçeveleri çözer', () => {
    const cozucu = new AkisCozucu();
    const olaylar = cozucu.yut(
      'event: start\ndata: {"conversationId":"k1"}\n\nevent: delta\ndata: {"text":"Merhaba"}\n\n',
    );

    expect(olaylar).toEqual([
      { type: 'start', data: { conversationId: 'k1' } },
      { type: 'delta', data: { text: 'Merhaba' } },
    ]);
  });

  it('çerçeve ortasından bölünen parçaları birleştirir', () => {
    const cozucu = new AkisCozucu();

    expect(cozucu.yut('event: del')).toEqual([]);
    expect(cozucu.yut('ta\ndata: {"text":"ya')).toEqual([]);
    expect(cozucu.yut('rım"}\n\n')).toEqual([{ type: 'delta', data: { text: 'yarım' } }]);
  });

  it('tamamlanmamış son çerçeveyi tamponda bekletir', () => {
    const cozucu = new AkisCozucu();
    const olaylar = cozucu.yut('event: delta\ndata: {"text":"bir"}\n\nevent: delta\ndata: {"tex');

    expect(olaylar).toEqual([{ type: 'delta', data: { text: 'bir' } }]);
    expect(cozucu.yut('t":"iki"}\n\n')).toEqual([{ type: 'delta', data: { text: 'iki' } }]);
  });

  it('yorum satırını (canlı tutma darbesi) atlar', () => {
    const cozucu = new AkisCozucu();
    expect(cozucu.yut(': ping\n\nevent: delta\ndata: {"text":"a"}\n\n')).toEqual([
      { type: 'delta', data: { text: 'a' } },
    ]);
  });

  it('çok satırlı data alanlarını birleştirir', () => {
    // ⚠️ Gövde satırlara bölünmüş bir JSON: yalnız ilk `data:` satırını almak
    //    ayrıştırmayı patlatır ve olay sessizce kaybolurdu.
    const cozucu = new AkisCozucu();
    expect(cozucu.yut('event: delta\ndata: {"text":\ndata: "ab"}\n\n')).toEqual([
      { type: 'delta', data: { text: 'ab' } },
    ]);
  });

  it('CRLF satır sonlarını kabul eder', () => {
    const cozucu = new AkisCozucu();
    expect(cozucu.yut('event: done\r\ndata: {"messageId":"m1"}\r\n\r\n')).toEqual([
      { type: 'done', data: { messageId: 'm1' } },
    ]);
  });

  it('tanınmayan olayı ve bozuk JSON’u sessizce atar, akışı kesmez', () => {
    const cozucu = new AkisCozucu();
    expect(
      cozucu.yut(
        'event: yeni_tip\ndata: {"a":1}\n\nevent: delta\ndata: {bozuk\n\nevent: delta\ndata: {"text":"b"}\n\n',
      ),
    ).toEqual([{ type: 'delta', data: { text: 'b' } }]);
  });
});

describe('aracMetni', () => {
  it('bilinen aracı Türkçe cümleye çevirir', () => {
    expect(aracMetni('search_products')).toBe('Ürünler aranıyor');
  });

  it('bilinmeyen araç adını EKRANA BASMAZ, genel cümleye düşer', () => {
    // ⚠️ Araç listesi sunucuda; yeni bir araç eklendiğinde istemci derlenmiyor.
    //    Varsayılan olmasaydı ekranda İngilizce `foo_bar` görünürdü.
    expect(aracMetni('foo_bar')).toBe('Bilgi getiriliyor');
  });
});
