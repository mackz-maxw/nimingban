import { AsyncStorage } from 'react-native'
import RNFS from 'react-native-fs';
import { request } from './network'
import { configNetwork, configLocal, configDynamic } from './config'

/**
 * 检查并返回最新的host，
 * 免得之后30x出问题
 */
async function checkRedirect() {
    // 如果不支持30x，直接返回固定地址
    if( !configNetwork.baseUrl[configDynamic.islandMode].useRedirect ) {
        return configNetwork.baseUrl[configDynamic.islandMode].base;
    }
    // 已经拿到了跳转之后的地址
    if(configDynamic.apiRedirectURL[configDynamic.islandMode] != null) {
        return configDynamic.apiRedirectURL[configDynamic.islandMode];
    }
    console.log('get new redirect');
    let response = await request(configNetwork.baseUrl[configDynamic.islandMode].base);
    if(response.stateCode != 200) {
        console.warn('get redirect error');
        return null;
    }
    if(response.responseURL.indexOf('/Forum')) {
        configDynamic.apiRedirectURL[configDynamic.islandMode] = response.responseURL.replace('/Forum', '');
        return configDynamic.apiRedirectURL[configDynamic.islandMode];
    }
    return null;
}

/**
 * 拼接url
 * @param {string} urlLink url参数
 */
async function getUrl(urlLink) {
    let url = await checkRedirect();
    return url===null?null:(url+urlLink);
}

/**
 * 将板块名字提取出来并缓存
 * @param {object} forumNames 板块完整列表
 */
async function _saveForumNameCache(forumNames) {
    let forumNameList = new Object();
    forumNames.forEach(groupItem => {
        groupItem.forums.forEach(item=>{
            forumNameList[item.id.toString()] = item.name;
        });
    });
    configDynamic.forumNamecache[configDynamic.islandMode] = forumNameList;
    await AsyncStorage.setItem(
        configLocal.localStorageName[configDynamic.islandMode].forumNameCache, 
        JSON.stringify(forumNameList)
    );
}

/**
 * 获取板块名字列表
 */
async function _getForumNameCache() {
    if(configDynamic.forumNamecache[configDynamic.islandMode] == null) {
        let localData = await AsyncStorage.getItem(configLocal.localStorageName[configDynamic.islandMode].forumNameCache);
        if(localData != null) {
            configDynamic.forumNamecache[configDynamic.islandMode] = JSON.parse(localData);
        }
    }
    return configDynamic.forumNamecache[configDynamic.islandMode];
}
/**
 * 获取板块列表
 * @param {bool} force 是否强制从网络端获取
 */
async function getForumList(force = false) {
    let localItem = await AsyncStorage.getItem(configLocal.localStorageName[configDynamic.islandMode].forumCache);
    // 本地没有缓存，或者需要强制获取
    if(localItem === null || force === true) {
        let url = await getUrl(configNetwork.apiUrl.getForumList);
        if(url === null) {
            return { status: 'error', errmsg: '获取host失败' };
        }
        let response = await request(url);
        if(response.stateCode != 200) {
            return { status: 'error', errmsg: `http:${response.stateCode},${response.errMsg}` };
        }
        localItem = response.body
        // 缓存到本地
        await AsyncStorage.setItem(configLocal.localStorageName[configDynamic.islandMode].forumCache, localItem);
    }
 
    try {
        let resJSON = JSON.parse(localItem);
        if(force === true) {
            _saveForumNameCache(resJSON);
        }
        return { status: 'ok', res: resJSON };
    } catch (error) {
        return { status: 'error', errmsg: error };
    }
}

/**
 * 获取板块内串列表
 * @param {Number} fid 板块ID
 * @param {Number} page 第几页
 */
async function getThreadList(fid, page) {
    let url = await getUrl((fid == -1)?configNetwork.apiUrl.timeLine:configNetwork.apiUrl.getForumThread);
    if(url === null) {
        return { status: 'error', errmsg: '获取host失败' };
    }

    let response = await request(url, {
        method: 'POST',
        body: 'id=' + fid + '&page=' + page,
    });
    if(response.stateCode != 200) {
        return { status: 'error', errmsg: `http:${response.stateCode},${response.errMsg}` };
    }
    try {
        let resJSON = JSON.parse(response.body);
        if( fid == -1 ) {
            let forumNameList = await _getForumNameCache();
            if(forumNameList !== null) {
                resJSON.forEach(item => {
                    item.fname = forumNameList[item.fid.toString()];
                });
            }
        }
        return { status: 'ok', res: resJSON };
    } catch (error) {
        return { status: 'error', errmsg: error };
    }
}

/**
 * 获取串回复
 * @param {Number} tid 串ID
 * @param {Number} page 分页
 */
async function getReplyList(tid, page) {
    let url = await getUrl(configNetwork.apiUrl.getThreadReply);
    if(url === null) {
        return { status: 'error', errmsg: '获取host失败' };
    }

    let response = await request(url, {
        method: 'POST',
        body: 'id=' + tid + '&page=' + page,
    });
    if(response.stateCode != 200) {
        return { status: 'error', errmsg: `http:${response.stateCode},${response.errMsg}` };
    }

    if(response.body == '"该主题不存在"') {
        return { status: 'error', errmsg: '该主题不存在' };
    }
    try {
        let resJSON = JSON.parse(response.body);
        return { status: 'ok', res: resJSON };
    } catch (error) {
        return { status: 'error', errmsg: error };
    }
}

/**
 * 获取图片CDN
 */
async function getImageCDN() {
    if(configDynamic.imageCDNURL[configDynamic.islandMode] == null) {
        console.log('get new image cdn url');
        let url = await getUrl(configNetwork.apiUrl.getImageCDN);
        if(url === null) {
            return null;
        }
        let response = await request(url);
        if(response.stateCode != 200) {
            return null;
        }
        try {
            let cdnList = JSON.parse(response.body);
            let maxRate = {url: 'https://nmbimg.fastmirror.org/', rate: 0};
            cdnList.forEach(item => {
                if(item.rate > maxRate.rate) {
                    maxRate = item;
                }
            });
            configDynamic.imageCDNURL[configDynamic.islandMode] = maxRate.url;
            return configDynamic.imageCDNURL[configDynamic.islandMode];
        }catch(error) {
            return null;
        }
    }
    else {
        return configDynamic.imageCDNURL[configDynamic.islandMode];
    }
}

/**
 * 清空缩略图缓存
 */
async function clearImageCache() {
    try {
        await RNFS.unlink(localDir.imageCacheThumb);
        return true;
    }catch(error) {
        return false;
    }
}

/**
 * 获取串图片
 * @param {String} imgMode 获取全图（image）还是缩略图（thumb）
 * @param {String} imageName 图片完整名
 */
async function getImage(imgMode, imageName) {
    try {
        var imgUrl = await getImageCDN() + imgMode + '/' + imageName;
        var localPath = (imgMode === 'thumb' ? configLocal.localDirectory.imageCacheThumb : configLocal.localDirectory.imageCacheFull) + '/' + imageName.replace('/','-');

        if(await RNFS.exists(localPath)) {
            console.log('Get image from cache.');
            return {
                status: 'ok',
                download: false,
                path: localPath
            }
        }

        if ( !await RNFS.exists(configLocal.localDirectory.imageCacheThumb) ) {
            console.log('Make new thumb image dir.');
            await RNFS.mkdir(configLocal.localDirectory.imageCacheThumb, { NSURLIsExcludedFromBackupKey: true });
        }
        if ( !await RNFS.exists(configLocal.localDirectory.imageCacheFull) ) {
            console.log('Make new full image dir.');
            await RNFS.mkdir(configLocal.localDirectory.imageCacheFull, { NSURLIsExcludedFromBackupKey: true });
        }
        let downloadRes = await RNFS.downloadFile({
            fromUrl: imgUrl,
            toFile: localPath,
            headers: configNetwork.apiRequestHeader,
            background: true,
            discretionary: true,
            cacheable: true,
        });

        let downloadStaRes = await downloadRes.promise;
        if(downloadStaRes.statusCode == 200 && downloadStaRes.bytesWritten > 0) {
            console.log('image download ok', localPath);
            return {
                status: 'ok',
                download: true,
                path: localPath
            }
        }
        else {
            console.log('image download error',downloadStaRes.statusCode.toString());
            return {
                status: 'error',
                download: true,
                errmsg: 'http:' + downloadStaRes.statusCode.toString(),
                path: localPath
            }
        }

    } catch (error) {
        console.log('image download error2', error);
        return {
            status: 'error',
            download: false,
            errmsg: error,
            path: localPath
        }
    }
}

export { 
    getUrl, /* 拼接URL */
    getForumList, /* 获取板块列表 */
    getThreadList, /* 获取板块中串列表 */
    getReplyList, /* 获取串回复列表 */
    getImage, /* 获取串中的缩略图或原图 */
    clearImageCache, /* 清空缩略图缓存 */
};