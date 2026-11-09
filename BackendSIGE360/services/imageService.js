const sharp = require('sharp');

/**
 * Função para comprimir e redimensionar a foto tipo passaporte
 */
async function comprimirFotoPassaporteParaBase64(fotoInput) {
    if (!fotoInput) return null;

    try {
        let bufferOriginal;

        if (typeof fotoInput === 'string' && fotoInput.startsWith('data:image')) {
            const base64Data = fotoInput.replace(/^data:image\/\w+;base64,/, '');
            bufferOriginal = Buffer.from(base64Data, 'base64');
        } else if (Buffer.isBuffer(fotoInput)) {
            bufferOriginal = fotoInput;
        } else {
            return fotoInput;
        }

        let qualidade = 70;
        let bufferComprimido = await sharp(bufferOriginal)
            .resize(250, 330, { fit: 'cover', position: 'center' })
            .jpeg({ quality: qualidade, mozjpeg: true })
            .toBuffer();

        while (bufferComprimido.length > 15360 && qualidade > 15) {
            qualidade -= 10;
            bufferComprimido = await sharp(bufferOriginal)
                .resize(250, 330, { fit: 'cover', position: 'center' })
                .jpeg({ quality: qualidade, mozjpeg: true })
                .toBuffer();
        }

        return `data:image/jpeg;base64,${bufferComprimido.toString('base64')}`;
    } catch (erro) {
        console.error("Erro ao comprimir imagem:", erro);
        throw new Error("Não foi possível processar a fotografia.");
    }
}

async function comprimirImagemParaLimite(bufferOriginal, limiteBytes = 100 * 1024) {
    if (typeof bufferOriginal === 'string') {
        const match = bufferOriginal.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) throw new Error('A fotografia enviada não tem um formato válido.');
        bufferOriginal = Buffer.from(match[1], 'base64');
    }
    if (!Buffer.isBuffer(bufferOriginal)) {
        throw new Error('A fotografia enviada não tem um formato válido.');
    }

    const dimensoes = [1600, 1280, 1024, 800, 640, 480, 320, 240];
    const qualidades = [85, 75, 65, 55, 45, 35, 25, 15];

    for (const dimensao of dimensoes) {
        for (const qualidade of qualidades) {
            const bufferComprimido = await sharp(bufferOriginal, { limitInputPixels: 20_000_000 })
                .rotate()
                .resize({
                    width: dimensao,
                    height: dimensao,
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: qualidade, mozjpeg: true })
                .toBuffer();

            if (bufferComprimido.length <= limiteBytes) {
                return `data:image/jpeg;base64,${bufferComprimido.toString('base64')}`;
            }
        }
    }

    throw new Error('Não foi possível reduzir a fotografia para 100 KB.');
}

module.exports = {comprimirFotoPassaporteParaBase64, comprimirImagemParaLimite};