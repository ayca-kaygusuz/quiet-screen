package com.quietscreen.android;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.webkit.*;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.AccountPicker;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public final class MainActivity extends ComponentActivity {
    static final String ORIGIN="https://appassets.androidplatform.net";
    static final String DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";
    static final int MAX_BODY=12*1024*1024, PICK_ACCOUNT=101, AUTHORIZE=102, SAVE_BACKUP=103, OPEN_BACKUP=104;
    private final ExecutorService workers=Executors.newFixedThreadPool(4);
    private final ConcurrentHashMap<Long,FutureTask<Void>> httpTasks=new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long,HttpURLConnection> httpConnections=new ConcurrentHashMap<>();
    WebView web;
    private SharedPreferences preferences;
    private volatile JSONObject account;
    private volatile String accessToken,tokenAccountId;
    private volatile long tokenUntil=0;
    private volatile boolean authPending=false,destroyed=false;
    private volatile long authGeneration=0;
    private int pickerRequestCode=3000,authorizationRequestCode=3001;
    private String accountError="",pendingBackup;
    private Account selectedAccount;
    private JavaScriptReplyProxy fileReply;
    private long fileRequest;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final Set<String> assets=Set.of("index.html","style.css","app.mjs","library.mjs","franchises.mjs","franchise-lookup.mjs","episode-releases.mjs","catalogue.mjs","releases.mjs","update-ui.mjs","sync/account.js","sync/sync-core.js","sync/drive.mjs","mobile/bootstrap.js","mobile/native-api.mjs","mobile/mobile.css","license.txt","NOTICE","THIRD_PARTY_NOTICES.md","native-notices.txt");

    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(),false);
        getWindow().getDecorView().setBackgroundColor(0xff17181d);
        preferences=getSharedPreferences("quiet-screen-account",MODE_PRIVATE);
        try{account=new JSONObject(preferences.getString("public_account",""));}catch(Exception ignored){}
        connectivity=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            android.widget.TextView message=new android.widget.TextView(this);message.setText("Update Android System WebView in Google Play, then reopen Quiet Screen.");message.setPadding(32,64,32,32);setContentView(message);return;
        }
        web=new WebView(this);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setGeolocationEnabled(false);settings.setSupportMultipleWindows(false);
        android.webkit.CookieManager.getInstance().setAcceptCookie(false);android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        final WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/",path->{
            String file=path.isEmpty()?"index.html":path;
            if(!assets.contains(file))return response(404,"text/plain","Not found");
            try{
                String mime=file.endsWith(".html")?"text/html":file.endsWith(".css")?"text/css":"application/javascript";
                Map<String,String> headers=new HashMap<>();headers.put("X-Content-Type-Options","nosniff");headers.put("Cache-Control","no-store");headers.put("Referrer-Policy","no-referrer");
                if(file.equals("index.html"))headers.put("Content-Security-Policy",readAsset("csp.txt"));
                return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open(file));
            }catch(Exception error){return response(500,"text/plain","The app assets could not be opened.");}
        }).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri u=request.getUrl();
                if(u.getHost()!=null&&u.getHost().equals("appassets.androidplatform.net"))return loader.shouldInterceptRequest(u);
                // Book covers can be loaded by WebView; all other network work uses the guarded native adapter.
                if(!request.isForMainFrame()&&"https".equals(u.getScheme())&&request.getMethod().equals("GET")&&coverHost(u.getHost()))return null;
                return response(403,"text/plain","Blocked request");
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                if(request.getUrl().toString().equals(ORIGIN+"/"))return false;
                if(request.hasGesture())openExternal(request.getUrl().toString());return true;
            }
            @Override public void onReceivedSslError(WebView view,android.webkit.SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){new android.app.AlertDialog.Builder(MainActivity.this).setTitle("Quiet Screen").setMessage(message).setPositiveButton("Continue",(d,w)->result.confirm()).setNegativeButton("Cancel",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){new android.app.AlertDialog.Builder(MainActivity.this).setTitle("Quiet Screen").setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setOnCancelListener(d->result.confirm()).show();return true;}
        });
        WebViewCompat.addWebMessageListener(web,"QuietScreenNative",Set.of(ORIGIN),(view,message,origin,mainFrame,reply)->{
            if(!mainFrame||!"https".equals(origin.getScheme())||!"appassets.androidplatform.net".equals(origin.getHost())||origin.getPort()!=-1)return;
            String text=message.getData();if(text==null||text.length()>2*MAX_BODY)return;
            long requestId=0;
            try{
                JSONObject value=new JSONObject(text);long id=value.getLong("id");requestId=id;String method=value.getString("method");JSONObject args=value.optJSONObject("parameters");if(id<1||args==null)return;
                if(method.equals("http.cancel")){long target=args.optLong("requestId");FutureTask<Void> task=httpTasks.remove(target);if(task!=null)task.cancel(true);HttpURLConnection c=httpConnections.remove(target);if(c!=null)c.disconnect();return;}
                if(method.equals("backup.save")||method.equals("backup.open")){pickBackup(id,reply,method,args);return;}
                if(method.equals("account.start")){startSignIn();send(reply,id,status(),null,null);return;}
                if(method.equals("account.cancel")){authGeneration++;authPending=false;selectedAccount=null;send(reply,id,status(),null,null);return;}
                if(method.equals("account.signout")){authGeneration++;authPending=false;account=null;accessToken=null;tokenAccountId=null;tokenUntil=0;accountError="";preferences.edit().remove("public_account").apply();send(reply,id,status(),null,null);return;}
                if(method.equals("open.external")){if(!openExternal(args.optString("url")))throw new Exception("This link cannot be opened by Quiet Screen.");send(reply,id,Boolean.TRUE,null,null);return;}
                if(method.equals("app.appearance")){String color=args.optString("color");if(!color.matches("#[0-9a-fA-F]{6}"))throw new Exception("Invalid appearance");int canvas=android.graphics.Color.parseColor(color);web.setBackgroundColor(canvas);getWindow().getDecorView().setBackgroundColor(canvas);getWindow().setStatusBarColor(canvas);getWindow().setNavigationBarColor(canvas);androidx.core.view.WindowInsetsControllerCompat controls=new androidx.core.view.WindowInsetsControllerCompat(getWindow(),getWindow().getDecorView());controls.setAppearanceLightStatusBars(args.optBoolean("light"));controls.setAppearanceLightNavigationBars(args.optBoolean("light"));send(reply,id,Boolean.TRUE,null,null);return;}
                Runnable work=()->{
                    try{
                        Object result;
                        switch(method){
                            case "asset.read":String asset=args.getString("name");if(!assets.contains(asset))throw new IOException("Blocked asset request");result=readAsset(asset);break;
                            case "app.info":result=new JSONObject().put("version",BuildConfig.VERSION_NAME);break;
                            case "account.status":result=status();break;
                            case "account.clearToken":clearToken();result=Boolean.TRUE;break;
                            case "http":result=http(args,id);break;
                            default:throw new Exception("Unsupported Android request.");
                        }
                        send(reply,id,result,null,null);
                    }catch(SignInRequired error){send(reply,id,null,error.getMessage(),"SIGN_IN_REQUIRED");}
                    catch(Exception error){send(reply,id,null,safeError(error),"ANDROID_REQUEST_ERROR");}
                };
                if(method.equals("http")){if(httpTasks.size()>=32)throw new IOException("Too many requests");FutureTask<Void> task=new FutureTask<Void>(work,null){@Override protected void done(){httpTasks.remove(id);HttpURLConnection c=httpConnections.remove(id);if(c!=null)c.disconnect();}};httpTasks.put(id,task);workers.execute(task);}else workers.execute(work);
            }catch(Exception error){send(reply,requestId,null,"The Android request could not be completed. Check your connection and try again.","ANDROID_REQUEST_ERROR");}
        });
        android.widget.FrameLayout content=new android.widget.FrameLayout(this);
        content.addView(web,new android.widget.FrameLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT,android.view.ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(content);web.loadUrl(ORIGIN+"/");
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(content,(view,insets)->{androidx.core.graphics.Insets bars=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()|androidx.core.view.WindowInsetsCompat.Type.displayCutout()|androidx.core.view.WindowInsetsCompat.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return androidx.core.view.WindowInsetsCompat.CONSUMED;});
        androidx.core.view.ViewCompat.requestApplyInsets(content);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){web.evaluateJavascript("!!globalThis.QuietScreenAndroid?.back?.()",value->{if(!"true".equals(value))finish();});}});
        networkCallback=new ConnectivityManager.NetworkCallback(){@Override public void onAvailable(Network network){refresh();}@Override public void onLost(Network network){refresh();}@Override public void onCapabilitiesChanged(Network network,NetworkCapabilities capabilities){refresh();}};
        connectivity.registerDefaultNetworkCallback(networkCallback);
    }
    private WebResourceResponse response(int status,String mime,String text){return new WebResourceResponse(mime,"UTF-8",status,status==404?"Not found":"Blocked",Map.of("Cache-Control","no-store"),new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));}
    private String readAsset(String name)throws IOException{try(InputStream stream=getAssets().open(name)){return new String(readLimited(stream,MAX_BODY),StandardCharsets.UTF_8);}}
    private static byte[] readLimited(InputStream stream,int limit)throws IOException{ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;while((count=stream.read(buffer))!=-1){if(bytes.size()+count>limit)throw new IOException("The response or backup is too large.");bytes.write(buffer,0,count);}return bytes.toByteArray();}
    private void send(JavaScriptReplyProxy reply,long id,Object value,String error,String code){runOnUiThread(()->{if(destroyed)return;try{JSONObject message=new JSONObject().put("id",id);if(error!=null)message.put("error",error).put("code",code);else message.put("value",value==null?JSONObject.NULL:value);reply.postMessage(message.toString());}catch(Exception ignored){}});}
    private String safeError(Exception error){return error instanceof IOException?"The connection or selected file could not be read. Your library is kept on this device.":"The Android request could not be completed. Try again.";}
    private JSONObject network()throws JSONException{Network active=connectivity.getActiveNetwork();NetworkCapabilities caps=active==null?null:connectivity.getNetworkCapabilities(active);boolean online=caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);return new JSONObject().put("online",online).put("metered",connectivity.isActiveNetworkMetered()).put("source","Android");}
    private synchronized JSONObject status()throws JSONException{return new JSONObject().put("mode","android").put("configured",BuildConfig.GOOGLE_AUTH_CONFIGURED).put("account",account==null?JSONObject.NULL:new JSONObject(account.toString())).put("pending",authPending).put("rememberSupported",true).put("network",network()).put("error",accountError);}
    private void refresh(){if(web!=null&&!destroyed)runOnUiThread(()->web.evaluateJavascript("globalThis.QuietScreenAccount?.refresh();globalThis.QuietScreenUpdates?.connectionChanged();",null));}
    @Override protected void onResume(){super.onResume();refresh();}
    @Override protected void onDestroy(){destroyed=true;authPending=false;authGeneration++;for(FutureTask<Void> task:httpTasks.values())task.cancel(true);for(HttpURLConnection c:httpConnections.values())c.disconnect();if(networkCallback!=null)try{connectivity.unregisterNetworkCallback(networkCallback);}catch(Exception ignored){}if(web!=null){web.stopLoading();web.destroy();}workers.shutdownNow();super.onDestroy();}

    private boolean coverHost(String host){return "m.media-amazon.com".equals(host);}
    private boolean openExternal(String address){try{Uri u=Uri.parse(address);String host=u.getHost();if(!"https".equals(u.getScheme())||u.getPort()!=-1||u.getUserInfo()!=null||host==null)return false;boolean allowed=Set.of("www.imdb.com","www.wikidata.org","www.tvmaze.com","www.apache.org","creativecommons.org").contains(host)||host.equals("github.com")&&u.getPath()!=null&&u.getPath().startsWith("/ayca-kaygusuz/quiet-screen/releases/");if(!allowed)return false;startActivity(new Intent(Intent.ACTION_VIEW,u).addCategory(Intent.CATEGORY_BROWSABLE));return true;}catch(Exception error){return false;}}
    private boolean allowedHttp(URL u,String method,boolean drive){String host=u.getHost(),path=u.getPath();if(!u.getProtocol().equals("https")||u.getPort()!=-1||u.getUserInfo()!=null)return false;if(drive)return host.equals("www.googleapis.com")&&(path.equals("/drive/v3/files")||path.matches("/drive/v3/files/[a-zA-Z0-9_-]+")||path.equals("/upload/drive/v3/files"))&&Set.of("GET","POST","DELETE").contains(method);if(!method.equals("GET"))return false;if(host.equals("v3.sg.media-imdb.com"))return path.startsWith("/suggestion/x/");if(host.equals("api.tvmaze.com"))return path.equals("/lookup/shows")||path.matches("/shows/[0-9]+")||path.matches("/shows/[0-9]+/episodes");if(host.equals("query-next.wikidata.org"))return path.equals("/sparql");if(host.equals("api.github.com"))return path.equals("/repos/ayca-kaygusuz/quiet-screen/releases/latest");if(host.equals("github.com"))return path.startsWith("/ayca-kaygusuz/quiet-screen/releases/download/")&&path.endsWith("/SHA256SUMS.txt");return Set.of("release-assets.githubusercontent.com","objects.githubusercontent.com").contains(host);}
    private JSONObject http(JSONObject args,long requestId)throws Exception{
        URL url=new URL(args.getString("url"));String method=args.optString("method","GET"),accountId=args.optString("accountId","");JSONObject headers=args.optJSONObject("headers");String marker=headers==null?"":headers.optString("authorization",headers.optString("Authorization",""));boolean drive=url.getHost().equals("www.googleapis.com")&&(url.getPath().startsWith("/drive/")||url.getPath().startsWith("/upload/drive/"));
        if(!allowedHttp(url,method,drive))throw new IOException("Blocked request");
        String token=null;if(drive){if(!marker.equals("Bearer native-account"))throw new SignInRequired();token=tokenFor(accountId);}
        HttpURLConnection connection=(HttpURLConnection)url.openConnection();httpConnections.put(requestId,connection);if(Thread.currentThread().isInterrupted()){httpConnections.remove(requestId);connection.disconnect();throw new IOException("Cancelled");}connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(20000);connection.setReadTimeout(45000);connection.setRequestMethod(method);
        if(headers!=null)for(Iterator<String> keys=headers.keys();keys.hasNext();){String name=keys.next(),value=headers.getString(name),lower=name.toLowerCase(Locale.ROOT);if(Set.of("accept","content-type","user-agent").contains(lower))connection.setRequestProperty(name,value);if(lower.equals("x-goog-api-key")&&url.getHost().equals("www.googleapis.com")&&url.getPath().startsWith("/books/v1/volumes"))connection.setRequestProperty(name,value);}
        if(token!=null)connection.setRequestProperty("Authorization","Bearer "+token);
        String body=args.optString("body","");if(args.isNull("body"))body="";if(!body.isEmpty()){byte[] bytes=body.getBytes(StandardCharsets.UTF_8);if(bytes.length>MAX_BODY)throw new IOException("Request too large");connection.setDoOutput(true);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}}
        try{
            int status=connection.getResponseCode();JSONObject responseHeaders=new JSONObject();for(Map.Entry<String,List<String>> entry:connection.getHeaderFields().entrySet())if(entry.getKey()!=null&&Set.of("content-type","location","content-length").contains(entry.getKey().toLowerCase(Locale.ROOT)))responseHeaders.put(entry.getKey(),String.join(", ",entry.getValue()));
            InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();String content="";if(stream!=null)try(stream){content=new String(readLimited(stream,MAX_BODY),StandardCharsets.UTF_8);}
            if(drive)synchronized(this){if(account==null||!accountId.equals(account.optString("id")))throw new SignInRequired();}
            return new JSONObject().put("status",status).put("headers",responseHeaders).put("body",content);
        }finally{connection.disconnect();}
    }
    private void pickBackup(long id,JavaScriptReplyProxy reply,String method,JSONObject args)throws Exception{
        if(fileReply!=null)throw new Exception("Finish the current file selection first.");
        if(method.equals("backup.save")){Object value=args.get("document");String body=value.toString();if(body.length()>MAX_BODY)throw new IOException("Backup too large");pendingBackup=body;fileReply=reply;fileRequest=id;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"quiet-screen-backup.json");startActivityForResult(intent,SAVE_BACKUP);}
        else{fileReply=reply;fileRequest=id;startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"),OPEN_BACKUP);}
    }
    private void startSignIn()throws Exception{
        if(!BuildConfig.GOOGLE_AUTH_CONFIGURED)throw new Exception("This Android build needs its Google connection configured.");if(authPending)return;if(!network().getBoolean("online"))throw new IOException("Offline");
        authGeneration++;pickerRequestCode=3000+(int)(authGeneration%10000)*2;authorizationRequestCode=pickerRequestCode+1;authPending=true;accountError="";Intent intent=AccountPicker.newChooseAccountIntent(new AccountPicker.AccountChooserOptions.Builder().setAllowableAccountsTypes(Arrays.asList("com.google")).setAlwaysShowAccountPicker(true).build());startActivityForResult(intent,pickerRequestCode);
    }
    private AuthorizationRequest authorization(Account selected){return AuthorizationRequest.builder().setAccount(selected).setRequestedScopes(Arrays.asList(new Scope(DRIVE_SCOPE),new Scope("openid"),new Scope("email"),new Scope("profile"))).build();}
    private void authorizeSelected(){final long generation=authGeneration;Identity.getAuthorizationClient(this).authorize(authorization(selectedAccount)).addOnSuccessListener(result->{if(!authPending||generation!=authGeneration)return;if(result.hasResolution()){try{startIntentSenderForResult(result.getPendingIntent().getIntentSender(),authorizationRequestCode,null,0,0,0);}catch(Exception error){authFailed(generation);}}else finishAuthorization(result,generation);}).addOnFailureListener(error->authFailed(generation));}
    private void authFailed(long generation){if(generation!=authGeneration)return;authPending=false;selectedAccount=null;accountError="Google sign-in could not be completed. Check the Android client setup and try again.";refresh();}
    private void finishAuthorization(AuthorizationResult result,long generation){workers.execute(()->{try{String token=result.getAccessToken();JSONObject identity=identity(token);synchronized(this){if(!authPending||generation!=authGeneration)return;account=identity;accessToken=token;tokenAccountId=identity.getString("id");tokenUntil=System.currentTimeMillis()+2700000;preferences.edit().putString("public_account",identity.toString()).apply();authPending=false;accountError="";}refresh();}catch(Exception error){runOnUiThread(()->authFailed(generation));}});}
    private JSONObject identity(String token)throws Exception{
        if(token==null||token.length()>8000)throw new SignInRequired();HttpURLConnection c=(HttpURLConnection)new URL("https://openidconnect.googleapis.com/v1/userinfo").openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(20000);c.setRequestProperty("Authorization","Bearer "+token);
        try{if(c.getResponseCode()!=200)throw new SignInRequired();JSONObject value=new JSONObject(new String(readLimited(c.getInputStream(),65536),StandardCharsets.UTF_8));String id=value.optString("sub"),email=value.optString("email");if(!id.matches("[0-9]{1,100}")||email.isEmpty()||email.length()>320||!value.optBoolean("email_verified"))throw new SignInRequired();return new JSONObject().put("id",id).put("email",email).put("name",value.optString("name",email));}finally{c.disconnect();}
    }
    private synchronized String tokenFor(String expected)throws Exception{
        if(account==null||!expected.equals(account.optString("id")))throw new SignInRequired();if(accessToken!=null&&expected.equals(tokenAccountId)&&System.currentTimeMillis()<tokenUntil)return accessToken;
        Account selected=new Account(account.getString("email"),"com.google");AuthorizationResult result=Tasks.await(Identity.getAuthorizationClient(this).authorize(authorization(selected)),30,TimeUnit.SECONDS);if(result.hasResolution())throw new SignInRequired();String token=result.getAccessToken();JSONObject verified=identity(token);if(!expected.equals(verified.optString("id"))||account==null||!expected.equals(account.optString("id")))throw new SignInRequired();tokenAccountId=expected;accessToken=token;tokenUntil=System.currentTimeMillis()+2700000;return token;
    }
    private synchronized void clearToken()throws Exception{String old=accessToken;accessToken=null;tokenAccountId=null;tokenUntil=0;if(old!=null)Tasks.await(Identity.getAuthorizationClient(this).clearToken(ClearTokenRequest.builder().setToken(old).build()),20,TimeUnit.SECONDS);}
    private static final class SignInRequired extends Exception{SignInRequired(){super("Sign in to Google again to reconnect Drive. Your library is kept on this device.");}}
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode>=3000){if(requestCode!=pickerRequestCode&&requestCode!=authorizationRequestCode)return;if(!authPending)return;if(resultCode!=Activity.RESULT_OK||data==null){authPending=false;selectedAccount=null;accountError="Sign-in cancelled.";refresh();return;}try{if(requestCode==pickerRequestCode){String email=data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);if(email==null||email.length()>320)throw new Exception();selectedAccount=new Account(email,"com.google");authorizeSelected();}else finishAuthorization(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data),authGeneration);}catch(Exception error){authFailed(authGeneration);}return;}
        if(requestCode!=SAVE_BACKUP&&requestCode!=OPEN_BACKUP)return;JavaScriptReplyProxy reply=fileReply;long id=fileRequest;String backup=pendingBackup;fileReply=null;pendingBackup=null;if(reply==null)return;if(resultCode!=Activity.RESULT_OK||data==null||data.getData()==null){send(reply,id,null,null,null);return;}Uri uri=data.getData();workers.execute(()->{try{if(requestCode==SAVE_BACKUP){try(OutputStream stream=getContentResolver().openOutputStream(uri,"wt")){if(stream==null)throw new IOException();stream.write(backup.getBytes(StandardCharsets.UTF_8));}send(reply,id,Boolean.TRUE,null,null);}else{String text;try(InputStream stream=getContentResolver().openInputStream(uri)){if(stream==null)throw new IOException();text=new String(readLimited(stream,10*1024*1024),StandardCharsets.UTF_8);}Object parsed=new JSONTokener(text).nextValue();if(!(parsed instanceof JSONObject)&&!(parsed instanceof JSONArray))throw new IOException();send(reply,id,parsed,null,null);}}catch(Exception error){send(reply,id,null,"The backup could not be read or saved. Your current library is kept.","BACKUP_ERROR");}});
    }
}
