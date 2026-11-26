package com.quietscreen.android;

import android.Manifest;
import android.content.pm.PackageInfo;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LibraryRuntimeTest {
    private String evaluate(ActivityScenario<MainActivity> scenario,String code)throws Exception{
        CountDownLatch done=new CountDownLatch(1);String[] result={null};
        scenario.onActivity(activity->activity.web.evaluateJavascript(code,value->{result[0]=value;done.countDown();}));
        assertTrue("JavaScript evaluation timed out",done.await(15,TimeUnit.SECONDS));return result[0];
    }
    private void ready(ActivityScenario<MainActivity> scenario)throws Exception{
        for(int i=0;i<150;i++){if("true".equals(evaluate(scenario,"!!globalThis.QuietScreenApp && !!globalThis.QuietScreenAccount && !!globalThis.QuietScreenAndroid?.back")))return;Thread.sleep(100);}
        fail("The Android app did not finish loading its shared interface");
    }
    private void screenshot(ActivityScenario<MainActivity> scenario,String name)throws Exception{
        CountDownLatch drawn=new CountDownLatch(1);
        scenario.onActivity(activity->activity.web.postVisualStateCallback(1,new WebView.VisualStateCallback(){@Override public void onComplete(long id){drawn.countDown();}}));
        assertTrue("WebView did not finish drawing",drawn.await(15,TimeUnit.SECONDS));
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();Thread.sleep(250);
        android.graphics.Bitmap bitmap=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        File folder=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null),"previews");folder.mkdirs();
        try(FileOutputStream out=new FileOutputStream(new File(folder,name+".png"))){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();
    }
    @Test public void sharedLibraryThemesMovieProgressAndRestart() throws Exception {
        try(ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)){
            ready(app);
            assertEquals("true",evaluate(app,"(()=>{QuietScreenApp.apply({library:[],lists:[],preferences:{theme:'ink'}});document.querySelector('#add').click();const f=document.querySelector('#title-form');f.elements.title.value='Android runtime movie';f.elements.status.value='Watching';f.requestSubmit();return QuietScreenApp.snapshot().library.length===1&&!!QuietScreenApp.snapshot().library[0].active})()"));
            assertEquals("true",evaluate(app,"(()=>{document.querySelector('#titles .row').click();return document.body.classList.contains('mobile-detail-open')})()"));
            assertEquals("true",evaluate(app,"QuietScreenAndroid.back()"));
            for(String theme:new String[]{"ink","sage","tide","rosewood","porcelain","apricot"}){
                assertEquals("true",evaluate(app,"(()=>{document.querySelector('#theme').value='"+theme+"';document.querySelector('#theme').dispatchEvent(new Event('change',{bubbles:true}));return document.documentElement.dataset.theme==='"+theme+"'&&document.documentElement.scrollWidth<=innerWidth})()"));
                screenshot(app,"android-theme-"+theme);
            }
            assertEquals("true",evaluate(app,"(()=>{const b=QuietScreenApp.backupDocument(QuietScreenApp.snapshot());return b.version===1&&b.titles.length===1&&!JSON.stringify(b).includes('access_token')})()"));
            app.recreate();ready(app);
            assertEquals("true",evaluate(app,"QuietScreenApp.snapshot().library[0].title==='Android runtime movie'&&!!QuietScreenApp.snapshot().library[0].active"));
        }
    }
}