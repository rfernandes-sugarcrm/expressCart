const axios = require('axios');
const authSugarApi = axios.create();
const sugarApi = axios.create();
const oauth = {};
const SUGAR_URL = 'http://docker.local/sugar/rest/v11_14'

function initSugar(){ // eslint-disable-line
    // Request interceptor for API calls
    authSugarApi.interceptors.request.use(
        async config => {
            if(oauth.access_token) {
                config.headers = { 
                'OAuth-Token': oauth.access_token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        }
        return config;
        },
        error => {
        Promise.reject(error)
    });
    
    // Response interceptor for API calls
    authSugarApi.interceptors.response.use((response) => {
        return response
    }, async (error) => {
        const originalRequest = error.config;
        if (error.response.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        const {data} = await sugarApi.post(`${SUGAR_URL}/oauth2/token`, {
            "grant_type":"password",
            "client_id":"sugar",
            "client_secret":"",
            "username":"admin",
            "password":"asdf",
            "platform":"mobile"
        });
        oauth.access_token = data.access_token
        axios.defaults.headers.common['Authorization'] = 'Bearer ' + oauth.access_token;
        return authSugarApi(originalRequest);
        }
        return Promise.reject(error);
    });
};

function post2Sugar(url, data){
    return authSugarApi.post(`${SUGAR_URL}/${url}`, data);
}

module.exports = {
    post2Sugar,
    initSugar
};
